import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, CARDS } from '../shared/game.js';
import {
  decideDeepSeek,
  candidateActions,
  publicCommand,
  resolveCommand
} from '../server/deepseek.js';
import {
  gameView,
  applyGameAction,
  newRoom,
  appendDeepSeekUpdates,
  deepSeekRulebook,
  newDeepSeekSession
} from '../server/room-core.js';
import { inferPositions, rankActions } from '../server/deepseek-tactics.js';

test('紧凑规则表保留每张牌的所有规则和属性', () => {
  const text = deepSeekRulebook(),
    rows = JSON.parse(text.split('null 表示无此属性：')[1].split('\n')[0]);
  assert.equal(rows.length, Object.keys(CARDS).length);
  for (const [
    key,
    name,
    type,
    cost,
    count,
    range,
    face,
    level,
    income,
    defense,
    star,
    escape,
    rule,
    detail
  ] of rows) {
    const card = CARDS[key];
    assert.ok(card);
    assert.deepEqual(
      [name, type, cost, count, range, face, level, income, defense, star, escape, rule, detail],
      [
        card.name,
        card.type,
        card.cost,
        card.count,
        card.range === Infinity ? '无限' : (card.range ?? null),
        card.face ?? null,
        card.level === Infinity ? '无限' : (card.level ?? null),
        card.income ?? null,
        card.defense ?? null,
        Boolean(card.star),
        Boolean(card.escape),
        card.rule ?? null,
        card.detail ?? null
      ]
    );
  }
});

test('决策不重复附带近期事件，完整公开记录保留在会话中', async () => {
  const game = new Game({ count: 3, demo: false }),
    history = [{ type: 'launch', actor: 1, target: 4, key: 'nuclear' }];
  for (const session of [null, newDeepSeekSession(game, 0, history)]) {
    let body, metrics;
    const result = await decideDeepSeek(
      game,
      0,
      history,
      'key',
      async (_url, init) => {
        body = JSON.parse(init.body);
        return Response.json({ choices: [{ message: { content: '{"type":"end"}' } }] });
      },
      session,
      null,
      (value) => {
        metrics = value;
      }
    );
    const payload = JSON.parse(body.messages.at(-1).content.split('当前局面：')[1]);
    assert.equal(payload.observations, undefined);
    assert.equal(payload.legalActions, undefined);
    assert.deepEqual(JSON.parse(body.messages[2].content.split('\n')[1]).publicEvidence, history);
    assert.deepEqual(result, { type: 'end' });
    assert.equal(metrics.observationWindow, 0);
  }
});

test('会话落后时补充过滤后的公开事件，不丢弃之前对话', async () => {
  const game = new Game({ count: 3, demo: false });
  const history = [
    { type: 'launch', actor: 1, target: 4 },
    { type: 'build', actor: 1, target: game.players[1].galaxy, key: 'solar' }
  ];
  const session = newDeepSeekSession(game, 0, history.slice(0, 1));
  session.messages.push({ role: 'assistant', content: '之前的决策' });
  const action = await decideDeepSeek(
    game,
    0,
    history,
    'key',
    async () => Response.json({ choices: [{ message: { content: '{"type":"end"}' } }] }),
    session
  );
  assert.deepEqual(action, { type: 'end' });
  assert.ok(session.messages.some((message) => message.content === '之前的决策'));
  const update = session.messages.find((message) => message.content.includes('牌局更新（记住'));
  assert.equal(JSON.parse(update.content.split('\n')[1]).publicEvidence[0].target, undefined);
  assert.equal(session.intelCursor, history.length);
});

test('DeepSeek 直接输出牌名行动并只收到自身手牌', async () => {
  const game = new Game({ count: 3, demo: false, seed: 73 });
  let body;
  const session = newDeepSeekSession(game, 0, []);
  const result = await decideDeepSeek(
    game,
    0,
    [],
    'secret',
    async (_url, init) => {
      body = JSON.parse(init.body);
      return Response.json({ choices: [{ message: { content: '{"type":"end"}' } }] });
    },
    session
  );
  assert.deepEqual(result, { type: 'end' });
  assert.equal(body.model, 'deepseek-flash');
  assert.deepEqual(body.thinking, { type: 'enabled' });
  assert.equal(body.reasoning_effort, 'high');
  assert.equal(body.max_tokens, 8192);
  const prompt = JSON.parse(body.messages.at(-1).content.split('当前局面：')[1]);
  assert.equal(prompt.legalActions, undefined);
  assert.ok(prompt.state.players[0].hand.every((card) => typeof card === 'string'));
  assert.equal(prompt.state.players[0].galaxy, game.players[0].galaxy);
  for (const player of prompt.state.players.slice(1)) {
    assert.equal(player.hand, undefined);
    assert.equal(player.galaxy, undefined);
  }
});

test('广播回应提示明确当前玩家、已完成回应者和是否允许不回应', async () => {
  const game = new Game({ count: 3, demo: false, seed: 73 });
  const player = game.players[1];
  player.energy = 10;
  player.hand = [
    { id: 'a', key: 'hyper_c' },
    { id: 'b', key: 'hyper_d' }
  ];
  game.pending = {
    kind: 'broadcast',
    caster: 2,
    target: game.players[0].galaxy,
    card: { id: 'broadcast', key: 'stellar_c' },
    decisions: [0],
    responses: []
  };
  for (const forced of [false, true]) {
    game.pending.target = forced ? player.galaxy : game.players[0].galaxy;
    let prompt;
    const action = await decideDeepSeek(game, 1, [], 'key', async (_url, init) => {
      const body = JSON.parse(init.body);
      prompt = JSON.parse(body.messages.at(-1).content.split('当前局面：')[1]);
      return Response.json({
        choices: [
          { message: { content: JSON.stringify({ type: 'respond', card: '超距广播·合作' }) } }
        ]
      });
    });
    assert.deepEqual(action, { type: 'respond', cardId: 'a' });
    assert.deepEqual(prompt.state.pending.completedResponders, [0]);
    assert.equal(prompt.state.pending.decisions, undefined);
    assert.match(prompt.decisionContext, /轮到玩家 1 回应广播/);
    assert.match(prompt.decisionContext, /已经完成回应/);
    assert.match(prompt.decisionContext, forced ? /必须使用/ : /可以选择不回应/);
  }
  assert.match(deepSeekRulebook(), /decisions（旧记录）.*已经完成回应/);
});

test('完整牌名映射实体牌并验证弃牌数量、广播牌面和各阶段行动', () => {
  const game = new Game({ count: 3, demo: false, seed: 73 });
  const p = game.players[0];
  p.energy = 20;
  p.hand = [
    { id: 'a', key: 'nuclear' },
    { id: 'b', key: 'nuclear' },
    { id: 'c', key: 'stellar_c' },
    { id: 'd', key: 'stellar_d' }
  ];
  const target = p.galaxy === 1 ? 2 : 1;
  let actions = candidateActions(game, 0);
  const shot = resolveCommand(game, 0, actions, { type: 'play', card: '热核打击', target });
  assert.ok(['a', 'b'].includes(shot.cardId));
  assert.equal(
    resolveCommand(game, 0, actions, { type: 'play', card: '热核打击', target: p.galaxy }),
    null
  );
  const discarded = resolveCommand(game, 0, actions, {
    type: 'discard',
    cards: ['热核打击', '热核打击']
  });
  assert.deepEqual(new Set(discarded.ids), new Set(['a', 'b']));
  assert.equal(
    resolveCommand(game, 0, actions, {
      type: 'discard',
      cards: ['热核打击', '热核打击', '热核打击']
    }),
    null
  );
  game.pending = { kind: 'broadcast', caster: 1, target: p.galaxy, decisions: [], responses: [] };
  actions = candidateActions(game, 0);
  assert.equal(
    resolveCommand(game, 0, actions, { type: 'respond', card: '恒星广播·合作' }).cardId,
    'c'
  );
  assert.equal(
    resolveCommand(game, 0, actions, { type: 'respond', card: '恒星广播·伪装' }).cardId,
    'd'
  );
  assert.equal(resolveCommand(game, 0, actions, { type: 'respond', card: '恒星广播' }), null);
  assert.equal(resolveCommand(game, 0, actions, { type: 'respond', card: null }), null);
  game.pending = {
    kind: 'broadcast',
    caster: 0,
    decisions: [1, 2],
    responses: [{ actor: 1 }, { actor: 2 }]
  };
  actions = candidateActions(game, 0);
  assert.deepEqual(resolveCommand(game, 0, actions, { type: 'settle', chosen: 2 }), {
    type: 'settle',
    chosen: 2
  });
  game.pending = { kind: 'escape', victim: 0 };
  actions = candidateActions(game, 0);
  assert.deepEqual(resolveCommand(game, 0, actions, { type: 'escape', use: true }), {
    type: 'escape',
    use: true
  });
  game.pending = null;
  game.strikes = [
    { id: 's1', owner: 0, target, progress: 1, card: { id: 's1', key: 'nuclear' } },
    { id: 's2', owner: 0, target, progress: 2, card: { id: 's2', key: 'nuclear' } }
  ];
  actions = candidateActions(game, 0);
  assert.deepEqual(
    resolveCommand(game, 0, actions, { type: 'withdraw', card: '热核打击', target, progress: 2 }),
    { type: 'withdraw', strikeId: 's2' }
  );
});

test('DeepSeek 过滤对手隐藏坐标，并安全重建旧对话且保留公开线索', async () => {
  const game = new Game({ count: 3, demo: false, seed: 73 }),
    room = newRoom('A2C4E6', 'host', '测试', '房主');
  room.status = 'playing';
  room.game = game;
  room.members = [0, 1, 2].map((id) => ({ id: 'bot' + id, name: 'bot' + id, bot: 'deepseek' }));
  room.intel = [
    { type: 'build', actor: 1, target: game.players[1].galaxy, key: 'solar' },
    { type: 'escaped', actor: 1, from: 2, to: game.players[1].galaxy },
    { type: 'launch', actor: 1, target: 4, key: 'nuclear' },
    { type: 'build', actor: 0, target: game.players[0].galaxy, key: 'solar' }
  ];
  room.deepseekSessions = {
    bot0: {
      messages: [
        { role: 'system', content: '规则' },
        { role: 'user', content: '旧记录含秘密 ' + JSON.stringify(room.intel) }
      ],
      lastState: gameView(game, 0),
      intelCursor: room.intel.length
    }
  };
  appendDeepSeekUpdates(room);
  const session = room.deepseekSessions.bot0;
  assert.equal(session.privacyVersion, 1);
  assert.equal(
    session.messages.some((m) => m.content.includes('旧记录含秘密')),
    false
  );
  const initial = JSON.parse(session.messages[2].content.split('\n')[1]);
  assert.equal(initial.publicEvidence[0].target, undefined);
  assert.equal(initial.publicEvidence[1].to, undefined);
  assert.equal(initial.publicEvidence[1].from, 2);
  assert.equal(initial.publicEvidence[2].target, 4);
  assert.equal(initial.publicEvidence[3].target, game.players[0].galaxy);
  assert.equal(room.intel[0].target, game.players[1].galaxy);
  assert.equal(room.intel[1].to, game.players[1].galaxy);
  for (let seat = 0; seat < 3; seat++) {
    const evidence = JSON.parse(
      room.deepseekSessions['bot' + seat].messages[2].content.split('\n')[1]
    ).publicEvidence;
    assert.equal(evidence[0].target, seat === 1 ? game.players[1].galaxy : undefined);
    assert.equal(evidence[1].to, seat === 1 ? game.players[1].galaxy : undefined);
    assert.equal(evidence[2].target, 4);
  }
  room.intel.push(
    { type: 'build', actor: 2, target: game.players[2].galaxy, key: 'solar' },
    { type: 'escaped', actor: 2, to: game.players[2].galaxy }
  );
  appendDeepSeekUpdates(room);
  const update = JSON.parse(session.messages.at(-1).content.split('\n')[1]);
  assert.equal(update.publicEvidence[0].target, undefined);
  assert.equal(update.publicEvidence[1].to, undefined);
  let request;
  await decideDeepSeek(
    game,
    0,
    room.intel,
    'key',
    async (_url, init) => {
      request = JSON.parse(init.body);
      return Response.json({ choices: [{ message: { content: '{"type":"end"}' } }] });
    },
    session
  );
  const decision = JSON.parse(request.messages.at(-1).content.split('当前局面：')[1]);
  assert.equal(decision.observations, undefined);
  assert.ok(request.messages.some((message) => message.content.includes('publicEvidence')));
  const legacy = { messages: [{ role: 'user', content: '旧秘密 ' + JSON.stringify(room.intel) }] };
  await decideDeepSeek(
    game,
    0,
    room.intel,
    'key',
    async (_url, init) => {
      request = JSON.parse(init.body);
      return Response.json({ choices: [{ message: { content: '{"type":"end"}' } }] });
    },
    legacy
  );
  assert.equal(
    request.messages.some((m) => m.content.includes('旧秘密')),
    false
  );
  assert.equal(
    JSON.parse(request.messages[2].content.split('\n')[1]).publicEvidence[0].target,
    undefined
  );
});

const state = () => ({
  active: 0,
  round: 3,
  played: false,
  markers: {},
  strikes: [],
  pending: null,
  players: [
    {
      id: 0,
      alive: true,
      galaxy: 9,
      energy: 12,
      escapeUsed: false,
      builds: [],
      hand: [],
      handCount: 0
    },
    ...[1, 2].map((id) => ({
      id,
      alive: true,
      energy: 5,
      escapeUsed: false,
      builds: [],
      handCount: 4
    }))
  ]
});
const card = (id, key) => ({ id, key });

test('位置推断结合公开命中与一星系一文明约束，逃生后清除旧坐标', () => {
  const view = state(),
    evidence = [{ type: 'lock', actor: 0, target: 1, victim: 1 }];
  const beliefs = inferPositions(view, 0, evidence);
  assert.deepEqual(beliefs.players[0].locations, [{ galaxy: 1, probability: 1 }]);
  assert.ok(beliefs.players[1].locations.every((x) => x.galaxy !== 1));
  const escaped = inferPositions(view, 0, [...evidence, { type: 'escaped', actor: 1, from: 1 }]);
  assert.ok(escaped.players[0].locations.length > 1);
  assert.ok(escaped.players[0].locations.every((x) => x.galaxy !== 1));
});

test('飞行进度约束发射位置，发射者跃迁后不再用于当前坐标', () => {
  const view = state(),
    launch = { type: 'launch', actor: 1, target: 1, strikeId: 's' };
  view.strikes = [{ id: 's', owner: 1, target: 1, progress: 2, card: card('s', 'nuclear') }];
  assert.deepEqual(inferPositions(view, 0, [launch]).players[0].locations, [
    { galaxy: 8, probability: 1 }
  ]);
  assert.ok(
    inferPositions(view, 0, [launch, { type: 'escaped', actor: 1, from: 8 }]).players[0].locations
      .length > 1
  );
});

test('逃生打击结算不会把逃生后的玩家重新定位到旧目标', () => {
  const view = state();
  const beliefs = inferPositions(view, 0, [
    { type: 'escaped', actor: 1, from: 1 },
    { type: 'impact', actor: 2, target: 1, victim: 1, outcome: 'escaped' }
  ]);
  assert.ok(beliefs.players[0].locations.length > 1);
  assert.ok(beliefs.players[0].locations.every((x) => x.galaxy !== 1));
});

test('致命来袭时优先有效防御，禁止消耗紧急防御预算', () => {
  const view = state();
  view.players[0].energy = 8;
  view.players[0].hand = [card('g', 'ghost'), card('f', 'fusion')];
  view.strikes = [{ id: 's', owner: 1, target: 9, progress: 1, card: card('s', 'annihilation') }];
  const { ranked } = rankActions(
    view,
    0,
    [],
    [{ type: 'play', cardId: 'f' }, { type: 'play', cardId: 'g' }, { type: 'end' }]
  );
  assert.deepEqual(ranked[0].action, { type: 'play', cardId: 'g' });
  assert.ok(!ranked.some((x) => x.action.cardId === 'f' || x.action.type === 'end'));
});

test('无法防御的来袭保留飞船所需10点能量', () => {
  const view = state();
  view.players[0].hand = [card('l', 'lightship'), card('f', 'fusion')];
  view.strikes = [{ id: 's', owner: 1, target: 9, progress: 0, card: card('s', 'dimension') }];
  const { ranked, tactics } = rankActions(
    view,
    0,
    [],
    [{ type: 'play', cardId: 'f' }, { type: 'end' }]
  );
  assert.equal(tactics.escapeEnergyReserved, true);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].action.type, 'end');
});

test('明确目标且可击穿防御时选择打击，避免重复在飞致命打击', () => {
  const view = state();
  view.players[0].hand = [card('n', 'nuclear')];
  const actions = [1, 2].map((target) => ({ type: 'play', cardId: 'n', target }));
  actions.push({ type: 'end' });
  const history = [{ type: 'lock', actor: 0, target: 1, victim: 1 }];
  const first = rankActions(view, 0, history, actions);
  assert.equal(first.ranked[0].action.target, 1);
  view.strikes = [
    { id: 's', owner: 0, target: 1, progress: 0, required: 1, card: card('s', 'nuclear') }
  ];
  const again = rankActions(view, 0, history, actions);
  assert.ok(again.ranked.find((x) => x.action.target === 1).score < first.ranked[0].score - 10);
});

test('同一张牌的多个目标不会挤掉紧急防御、存能或其他卡牌候选', () => {
  const view = state();
  view.players[0].hand = [card('s', 'stellar_d'), card('f', 'fusion')];
  const actions = Array.from({ length: 9 }, (_, i) => ({
    type: 'play',
    cardId: 's',
    target: i + 1
  }));
  actions.push({ type: 'play', cardId: 'f' }, { type: 'end' });
  const { ranked } = rankActions(view, 0, [], actions);
  assert.ok(ranked.some((x) => x.action.cardId === 'f'));
  assert.ok(ranked.some((x) => x.action.type === 'end'));
});

test('存能即可在下回合建戴森球时，保留关键建设而不随意弃掉', () => {
  const view = state();
  view.players[0].energy = 5;
  view.players[0].hand = [card('d', 'dyson')];
  const { ranked, tactics } = rankActions(
    view,
    0,
    [],
    [{ type: 'discard', ids: ['d'] }, { type: 'end' }]
  );
  assert.equal(tactics.savingFor, '戴森球');
  assert.equal(
    ranked.find((x) => x.action.type === 'end').score >
      ranked.find((x) => x.action.type === 'discard').score,
    true
  );
});

test('模型请求与战术分析不会随对手隐藏手牌和坐标改变', async () => {
  const game = new Game({ count: 3, demo: false, seed: 73 }),
    requests = [];
  const fake = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return Response.json({
      choices: [{ message: { content: '{"type":"end"}' } }]
    });
  };
  await decideDeepSeek(game, 0, [], 'secret', fake);
  [game.players[1].galaxy, game.players[2].galaxy] = [
    game.players[2].galaxy,
    game.players[1].galaxy
  ];
  game.players[1].hand = game.players[1].hand.map((c) => ({ ...c, key: 'dimension' }));
  await decideDeepSeek(game, 0, [], 'secret', fake);
  const normalize = (request) => {
    const copy = structuredClone(request),
      message = copy.messages.at(-1),
      prefix = '当前局面：';
    const data = JSON.parse(message.content.split(prefix)[1]);
    message.content = prefix + JSON.stringify(data);
    return copy;
  };
  assert.deepEqual(normalize(requests[0]), normalize(requests[1]));
});

test('公开打击事实持久记录且只在广播揭示后记录牌面', () => {
  const room = newRoom('12345678', 'host', '测试', '测试');
  room.game = new Game({ count: 3 });
  room.status = 'playing';
  const g = room.game,
    lock = g.players[0].hand.find((c) => c.key === 'lock');
  applyGameAction(room, 0, { type: 'play', cardId: lock.id, target: 1 });
  const event = room.intel.find((e) => e.type === 'lock');
  assert.deepEqual(
    [event.type, event.actor, event.target, event.key, event.victim],
    ['lock', 0, 1, 'lock', 1]
  );
  assert.equal(typeof event.refund, 'number');
  assert.ok(Array.isArray(event.removed));
  const broadcast = g.players[0].hand.find((c) => c.key === 'stellar_c');
  applyGameAction(room, 0, { type: 'play', cardId: broadcast.id, target: 5 });
  assert.equal(
    room.intel.some((e) => e.type === 'broadcast'),
    false
  );
});

test('DeepSeek 无密钥、接口错误或越界选择时安全回退', async () => {
  const game = new Game({ count: 3, demo: false, seed: 73 });
  let called = false;
  assert.equal(
    await decideDeepSeek(game, 0, [], null, async () => {
      called = true;
    }),
    null
  );
  assert.equal(called, false);
  assert.equal(
    await decideDeepSeek(game, 0, [], 'key', async () => new Response('error', { status: 503 })),
    null
  );
  assert.equal(
    await decideDeepSeek(game, 0, [], 'key', async () =>
      Response.json({ choices: [{ message: { content: '{"choice":999}' } }] })
    ),
    null
  );
});

test('DeepSeek候选在3/4/6人局面中合法推进且卡牌守恒', async () => {
  for (const count of [3, 4, 6]) {
    const room = newRoom('12345678', 'host', '模拟', '模拟');
    room.game = new Game({ count, demo: false, seed: 100 + count });
    room.status = 'playing';
    const fake = async (_url, init) => {
      const body = JSON.parse(init.body),
        data = JSON.parse(body.messages.at(-1).content.split('当前局面：')[1]);
      const game = room.game,
        me = data.me;
      const candidates = candidateActions(game, me);
      const best = candidates.find((item) => item.type === 'play') || candidates[0];
      return Response.json({
        choices: [{ message: { content: JSON.stringify(publicCommand(game, me, best)) } }]
      });
    };
    let steps = 0;
    while (!room.game.over && steps++ < 80) {
      if (room.game.pending?.autoSettleAt) {
        const now = Date.now;
        Date.now = () => room.game.pending.autoSettleAt;
        try {
          applyGameAction(room, room.game.pending.caster, { type: 'settle', chosen: null });
        } finally {
          Date.now = now;
        }
        continue;
      }
      let moved = false;
      for (let me = 0; me < count; me++) {
        const action = await decideDeepSeek(room.game, me, room.intel, 'fake', fake);
        if (!action) continue;
        applyGameAction(room, me, action);
        moved = true;
        assert.equal(room.game.allPhysicalCards().length, 64);
        break;
      }
      assert.ok(moved, '候选策略不可停滞');
    }
  }
});
