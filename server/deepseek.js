import { CARDS, GALAXIES, distance } from '../shared/game.js';
import { gameView, deepSeekRulebook, playerIntelView, newDeepSeekSession } from './room-core.js';
import { aliasText, migrateAliases } from './prompt-alias.js';

const cardLabel = (key) => {
  const card = CARDS[key];
  return card ? card.name + (card.face ? `·${card.face}` : '') : '未知卡牌';
};

export function publicCommand(game, me, action) {
  const hand = game.players[me].hand;
  const name = (id) => cardLabel(hand.find((card) => card.id === id)?.key);
  if (action.type === 'play')
    return {
      type: 'play',
      card: name(action.cardId),
      ...(action.target === undefined ? {} : { target: action.target })
    };
  if (action.type === 'respond')
    return { type: 'respond', card: action.cardId ? name(action.cardId) : null };
  if (action.type === 'discard') return { type: 'discard', cards: action.ids.map(name).sort() };
  if (action.type === 'withdraw') {
    const strike = game.strikes.find((item) => item.id === action.strikeId);
    return {
      type: 'withdraw',
      card: cardLabel(strike.card.key),
      target: strike.target,
      progress: strike.progress
    };
  }
  if (action.type === 'settle') return { type: 'settle', chosen: action.chosen };
  if (action.type === 'escape') return { type: 'escape', use: action.use };
  return { type: action.type };
}

export function resolveCommand(game, me, actions, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const input = raw.action && typeof raw.action === 'object' ? raw.action : raw;
  let command;
  if (input.type === 'play')
    command = {
      type: 'play',
      card: input.card,
      ...(input.target == null ? {} : { target: input.target })
    };
  else if (input.type === 'respond') command = { type: 'respond', card: input.card ?? null };
  else if (
    input.type === 'discard' &&
    Array.isArray(input.cards) &&
    input.cards.every((name) => typeof name === 'string')
  )
    command = { type: 'discard', cards: [...input.cards].sort() };
  else if (input.type === 'withdraw')
    command = {
      type: 'withdraw',
      card: input.card,
      target: input.target,
      progress: input.progress
    };
  else if (input.type === 'settle') command = { type: 'settle', chosen: input.chosen ?? null };
  else if (input.type === 'escape') command = { type: 'escape', use: input.use };
  else if (input.type === 'end') command = { type: 'end' };
  else return null;
  const encoded = JSON.stringify(command);
  return (
    actions.find((action) => JSON.stringify(publicCommand(game, me, action)) === encoded) || null
  );
}

export function candidateActions(game, me) {
  const p = game.players[me],
    pending = game.pending;
  if (!p?.alive || game.over) return [];
  if (pending?.kind === 'escape')
    return pending.victim === me
      ? [
          { type: 'escape', use: true },
          { type: 'escape', use: false }
        ]
      : [];
  if (pending?.kind === 'broadcast') {
    if (me === pending.caster) {
      if (game.players.some((q) => q.alive && q.id !== me && !pending.decisions.includes(q.id)))
        return [];
      return pending.responses.length
        ? pending.responses.map((r) => ({ type: 'settle', chosen: r.actor }))
        : [{ type: 'settle', chosen: null }];
    }
    if (pending.decisions.includes(me)) return [];
    const options = game.responseOptions(me).map((c) => ({ type: 'respond', cardId: c.id }));
    if (!game.isForced(me)) options.push({ type: 'respond' });
    return options;
  }
  if (game.active !== me) return [];
  const actions = [];
  for (const card of p.hand) {
    const d = CARDS[card.key];
    if (
      !d ||
      p.energy < d.cost ||
      d.escape ||
      (d.star && game.markers[p.galaxy]) ||
      (card.key === 'dyson' && p.builds.some((c) => c.key === 'dyson'))
    )
      continue;
    if (d.type === 'build') actions.push({ type: 'play', cardId: card.id });
    else
      for (const g of GALAXIES) {
        if (d.type === 'broadcast' && distance(p.galaxy, g.id) <= d.range)
          actions.push({ type: 'play', cardId: card.id, target: g.id });
        else if (d.type === 'strike' && g.id !== p.galaxy && game.markers[g.id] !== 'gray')
          actions.push({ type: 'play', cardId: card.id, target: g.id });
      }
  }
  if (!game.played)
    for (let mask = 1; mask < 1 << p.hand.length; mask++) {
      const ids = p.hand.filter((_, i) => mask & (1 << i)).map((c) => c.id);
      actions.push({ type: 'discard', ids });
    }
  for (const s of game.strikes)
    if (s.owner === me) actions.push({ type: 'withdraw', strikeId: s.id });
  actions.push({ type: 'end' });
  // Keep list position from implying a preference for any particular action.
  for (let i = actions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [actions[i], actions[j]] = [actions[j], actions[i]];
  }
  return actions;
}

function publicState(view, me) {
  return {
    round: view.round,
    active: view.active,
    played: view.played,
    markers: view.markers,
    ownBroadcast: view.ownBroadcastKey ? cardLabel(view.ownBroadcastKey) : undefined,
    players: view.players.map((p) => ({
      id: p.id,
      name: p.name,
      alive: p.alive,
      energy: p.energy,
      escapeUsed: p.escapeUsed,
      builds: p.builds.map((c) => cardLabel(c.key)),
      handCount: p.handCount,
      ...(p.id === me ? { galaxy: p.galaxy, hand: p.hand.map((c) => cardLabel(c.key)) } : {})
    })),
    strikes: view.strikes.map((s) => ({
      owner: s.owner,
      target: s.target,
      progress: s.progress,
      ...(s.required === undefined ? {} : { required: s.required }),
      card: cardLabel(s.card.key)
    })),
    latest: view.latest
      ? {
          kind: view.latest.kind,
          target: view.latest.target,
          revealed: view.latest.revealed,
          outcome: view.latest.outcome,
          victimId: view.latest.victimId,
          cards: view.latest.cards.map((c) => ({
            actor: c.actor,
            role: c.role,
            ...(c.key ? { key: c.key } : {})
          }))
        }
      : null,
    pending:
      view.pending?.kind === 'broadcast'
        ? {
            kind: 'broadcast',
            caster: view.pending.caster,
            target: view.pending.target,
            completedResponders: view.pending.decisions,
            responses: view.pending.responses.map((r) => ({ actor: r.actor }))
          }
        : view.pending
          ? {
              kind: view.pending.kind,
              victim: view.pending.victim,
              strikeId: view.pending.strikeId
            }
          : null
  };
}

/** Ask DeepSeek to choose one server-generated legal action. Returns null on any API/format failure. */
function cleanLegacySession(session) {
  if (!session?.messages) return;
  const messages = session.messages;
  if (messages[0]?.role === 'system') {
    const marker = messages[0].content.indexOf('\n\n决策纪律：');
    if (marker >= 0) messages[0].content = messages[0].content.slice(0, marker);
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user' && messages[i].content.includes('本次候选及局势补充如下：')) {
      messages.splice(i, 1);
      if (messages[i]?.role === 'assistant') messages.splice(i, 1);
    }
  }
}

/** Ask DeepSeek to choose one server-generated legal action. Returns null on any API/format failure. */
export async function decideDeepSeek(
  game,
  me,
  history,
  apiKey,
  fetchImpl = fetch,
  session = null,
  onDecision = null,
  onMetrics = null,
  options = {}
) {
  const started = Date.now(),
    metric = {
      schemaVersion: 1,
      promptVersion: 'compact-cards-v2',
      model: 'deepseek-flash',
      thinking: 'enabled',
      reasoningEffort: 'high',
      maxTokens: 8192,
      apiCalled: false,
      status: 'missing_key',
      phase:
        game.pending?.kind === 'broadcast'
          ? game.pending.caster === me
            ? 'settle'
            : 'respond'
          : game.pending?.kind === 'escape'
            ? 'escape'
            : 'turn',
      candidates: 0
    };
  const emit = () => {
    try {
      onMetrics?.({ ...metric, startedAt: started, durationMs: Date.now() - started });
    } catch {
      /* Metrics must not affect play. */
    }
  };
  if (!apiKey) {
    emit();
    return null;
  }
  if (
    session &&
    (session.privacyVersion !== 1 ||
      !Number.isInteger(session.intelCursor) ||
      session.intelCursor > history.length)
  ) {
    const safe = newDeepSeekSession(game, me, history);
    for (const key of Object.keys(session)) delete session[key];
    Object.assign(session, safe);
  }
  if (session) migrateAliases(session);
  if (session && session.intelCursor < history.length) {
    const evidence = playerIntelView(history.slice(session.intelCursor), me);
    session.messages.push({
      role: 'user',
      content:
        '牌局更新（记住，勿输出）：\n' +
        aliasText(JSON.stringify({ publicEvidence: evidence }), session)
    });
    session.intelCursor = history.length;
  }
  cleanLegacySession(session);
  if (session?.messages?.[0]?.role === 'system') session.messages[0].content = deepSeekRulebook();
  Object.assign(metric, { observationWindow: 0, promptVersion: 'direct-card-names-v2' });
  const actions = candidateActions(game, me);
  metric.candidates = actions.length;
  if (!actions.length) {
    metric.status = 'no_actions';
    emit();
    return null;
  }
  if (actions.length === 1) {
    metric.status = 'forced';
    metric.actionType = actions[0].type;
    emit();
    onDecision?.({ actionType: actions[0].type, source: 'forced', choice: null, candidates: 1 });
    return actions[0];
  }
  const view = gameView(game, me);
  // The bot knows the face it played; no other pending card face is exposed.
  if (game.pending?.kind === 'broadcast')
    view.ownBroadcastKey =
      game.pending.caster === me
        ? game.pending.card.key
        : game.pending.responses.find((r) => r.actor === me)?.card.key;
  const workingSession = session || newDeepSeekSession(game, me, history);
  const aliasSession = workingSession;
  const decisionMessage = {
    role: 'user',
    content:
      '现在请按规则直接输出一个行动 JSON，不要输出候选编号。卡牌使用完整牌名，广播牌附上合作或伪装牌面。当前局面：' +
      aliasText(
        JSON.stringify({
          me,
          ...(metric.phase === 'respond'
            ? {
                decisionContext: `现在轮到玩家 ${me} 回应广播。completedResponders 是已经完成回应的玩家（包括选择不回应的人），不是正在等待回应的玩家。请输出 respond 行动。${
                  actions.some((action) => action.type === 'respond' && !action.cardId)
                    ? '你可以选择不回应（card 为 null），也可以使用符合条件的广播牌。'
                    : '你必须使用符合条件的广播牌回应，不能选择不回应。'
                }`
              }
            : {}),
          state: publicState(view, me)
        }),
        aliasSession
      )
  };
  const messages = workingSession.messages;
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 30000);
  const requestBody = {
    model: 'deepseek-flash',
    thinking: { type: 'enabled' },
    reasoning_effort: 'high',
    max_tokens: 8192,
    response_format: { type: 'json_object' },
    messages: [...messages, decisionMessage]
  };
  const bytes = (value) => new TextEncoder().encode(value).byteLength;
  const attempts = [];
  Object.assign(metric, {
    apiCalled: true,
    status: 'request_error',
    requestBytes: 0,
    messageCount: requestBody.messages.length,
    systemBytes: requestBody.messages
      .filter((m) => m.role === 'system')
      .reduce((n, m) => n + bytes(m.content), 0),
    decisionBytes: bytes(decisionMessage.content),
    historyBytes: messages
      .filter((m) => m.role !== 'system')
      .reduce((n, m) => n + bytes(m.content), 0),
    attempts
  });
  const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const body = JSON.stringify({
        ...requestBody,
        messages: attempt
          ? [
              ...requestBody.messages,
              {
                role: 'user',
                content: '上次行动不合法或格式有误。请根据当前局面和规则重新输出一个合法行动 JSON。'
              }
            ]
          : requestBody.messages
      });
      const item = { requestBytes: bytes(body), status: 'request_error' };
      attempts.push(item);
      metric.requestBytes += item.requestBytes;
      const response = await fetchImpl('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        signal: controller.signal,
        body
      });
      const raw = await response.text();
      item.httpStatus = metric.httpStatus = response.status;
      if (!response.ok) {
        item.status = metric.status = 'http_error';
        console.warn('DeepSeek API returned status', response.status);
        return null;
      }
      item.status = metric.status = 'invalid_response';
      const data = JSON.parse(raw);
      const reasoning = data?.choices?.[0]?.message?.reasoning_content;
      if (typeof reasoning === 'string' && reasoning) {
        try {
          options.onReasoning?.(reasoning);
        } catch {
          /* Recording must not change the decision. */
        }
      }
      const content = data?.choices?.[0]?.message?.content;
      if (typeof data.model === 'string' && /^deepseek-[a-z0-9._-]{1,80}$/i.test(data.model))
        metric.responseModel = data.model;
      item.usage = {
        promptTokens: count(data.usage?.prompt_tokens),
        cacheHitTokens: count(
          data.usage?.prompt_cache_hit_tokens ?? data.usage?.prompt_tokens_details?.cached_tokens
        ),
        cacheMissTokens: count(data.usage?.prompt_cache_miss_tokens),
        completionTokens: count(data.usage?.completion_tokens),
        reasoningTokens: count(data.usage?.completion_tokens_details?.reasoning_tokens),
        totalTokens: count(data.usage?.total_tokens)
      };
      metric.usage = Object.fromEntries(
        Object.keys(item.usage).map((key) => [
          key,
          attempts.every((entry) => Number.isSafeInteger(entry.usage?.[key]))
            ? attempts.reduce((sum, entry) => sum + entry.usage[key], 0)
            : null
        ])
      );
      metric.finishReason = ['stop', 'length', 'content_filter', 'tool_calls'].includes(
        data?.choices?.[0]?.finish_reason
      )
        ? data.choices[0].finish_reason
        : 'unknown';
      if (typeof content !== 'string') {
        item.status = metric.status = 'missing_content';
        return null;
      }
      if (data?.choices?.[0]?.finish_reason === 'length') {
        item.status = metric.status = 'truncated';
        return null;
      }
      let result;
      try {
        result = JSON.parse(content);
      } catch {
        result = null;
      }
      const action = resolveCommand(game, me, actions, result);
      if (!action) {
        item.status = metric.status = 'invalid_action';
        if (!attempt && !controller.signal.aborted) continue;
        console.warn('DeepSeek API returned an invalid action');
        return null;
      }
      const saved = JSON.stringify(publicCommand(game, me, action));
      if (session?.messages)
        session.messages.push(decisionMessage, { role: 'assistant', content: saved });
      item.status = metric.status = 'success';
      metric.actionType = action.type;
      onDecision?.({ actionType: action.type, source: 'model', candidates: actions.length });
      return action;
    }
    return null;
  } catch (error) {
    if (error?.name === 'AbortError') {
      metric.status = 'timeout';
      if (attempts.length) attempts.at(-1).status = 'timeout';
    }
    console.warn('DeepSeek API request failed', error?.name || 'unknown error');
    return null;
  } finally {
    const usage = attempts.find((item) => item.usage)?.usage;
    if (usage)
      metric.usage = Object.fromEntries(
        Object.keys(usage).map((key) => [
          key,
          attempts.every((item) => Number.isSafeInteger(item.usage?.[key]))
            ? attempts.reduce((sum, item) => sum + item.usage[key], 0)
            : null
        ])
      );
    clearTimeout(timer);
    emit();
  }
}
