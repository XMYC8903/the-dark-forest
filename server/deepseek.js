import { CARDS, GALAXIES, distance } from '../shared/game.js';
import { gameView, deepSeekRulebook, playerIntelView, newDeepSeekSession } from './room-core.js';
import { aliasText, migrateAliases } from './prompt-alias.js';

function candidateActions(game, me) {
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
    ownBroadcastKey: view.ownBroadcastKey,
    players: view.players.map((p) => ({
      id: p.id,
      name: p.name,
      alive: p.alive,
      energy: p.energy,
      escapeUsed: p.escapeUsed,
      builds: p.builds.map((c) => c.key),
      handCount: p.handCount,
      ...(p.id === me
        ? { galaxy: p.galaxy, hand: p.hand.map((c) => ({ id: c.id, key: c.key })) }
        : {})
    })),
    strikes: view.strikes.map((s) => ({
      owner: s.owner,
      target: s.target,
      progress: s.progress,
      ...(s.required === undefined ? {} : { required: s.required }),
      cardKey: s.card.key
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
            decisions: view.pending.decisions,
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
      maxTokens: 4096,
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
  if (session && session.privacyVersion !== 1) {
    const safe = newDeepSeekSession(game, me, history);
    for (const key of Object.keys(session)) delete session[key];
    Object.assign(session, safe);
  }
  if (session) migrateAliases(session);
  cleanLegacySession(session);
  const requestedWindow = [0, 3, 24, '0', '3', '24'].includes(options.observationWindow)
    ? Number(options.observationWindow)
    : 24;
  // Only deduplicate when the entire event history has already entered this
  // seat's safe conversation. Standalone or stale sessions keep the old window.
  const observationWindow =
    session?.privacyVersion === 1 && session.intelCursor === history.length ? requestedWindow : 24;
  Object.assign(metric, {
    requestedObservationWindow: requestedWindow,
    observationWindow,
    promptVersion: 'compact-cards-v3-alias-obs' + observationWindow
  });
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
  const legalActions = actions.map((action, choice) => ({
    choice,
    action,
    ...(action.cardId ? { cardKey: pCardKey(game, me, action.cardId) } : {}),
    ...(action.ids ? { cardKeys: action.ids.map((id) => pCardKey(game, me, id)) } : {})
  }));
  const observations = playerIntelView(
    observationWindow ? history.slice(-observationWindow) : [],
    me
  ).map((e) => ({
    type: e.type,
    actor: e.actor,
    target: e.target,
    ...(e.key ? { cardKey: e.key } : {})
  }));
  const aliasSession = session || {};
  const decisionMessage = {
    role: 'user',
    content:
      '现在请决策。卡牌 key 对应规则书的完整牌面；id 用于区分手牌，星系编号对应星图。只输出 JSON：{"choice":候选编号}。当前局面：' +
      aliasText(
        JSON.stringify({
          me,
          state: publicState(view, me),
          ...(observationWindow ? { observations } : {}),
          legalActions
        }),
        aliasSession
      )
  };
  const conversation = session?.messages || [
    { role: 'system', content: deepSeekRulebook() },
    {
      role: 'user',
      content: '当前局面：' + aliasText(JSON.stringify(publicState(view, me)), aliasSession)
    }
  ];
  const messages = session?.messages || conversation;
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 30000);
  const requestBody = {
    model: 'deepseek-flash',
    thinking: { type: 'enabled' },
    reasoning_effort: 'high',
    max_tokens: 4096,
    response_format: { type: 'json_object' },
    messages: [...messages, decisionMessage]
  };
  const body = JSON.stringify(requestBody),
    bytes = (value) => new TextEncoder().encode(value).byteLength;
  Object.assign(metric, {
    apiCalled: true,
    status: 'request_error',
    requestBytes: bytes(body),
    messageCount: requestBody.messages.length,
    systemBytes: requestBody.messages
      .filter((m) => m.role === 'system')
      .reduce((n, m) => n + bytes(m.content), 0),
    decisionBytes: bytes(decisionMessage.content),
    historyBytes: messages
      .filter((m) => m.role !== 'system')
      .reduce((n, m) => n + bytes(m.content), 0)
  });
  try {
    const response = await fetchImpl('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body
    });
    const raw = await response.text();
    metric.httpStatus = response.status;
    if (!response.ok) {
      metric.status = 'http_error';
      console.warn('DeepSeek API returned status', response.status);
      return null;
    }
    metric.status = 'invalid_response';
    const data = JSON.parse(raw);
    const content = data?.choices?.[0]?.message?.content;
    if (typeof data.model === 'string' && /^deepseek-[a-z0-9._-]{1,80}$/i.test(data.model))
      metric.responseModel = data.model;
    const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
    metric.usage = {
      promptTokens: count(data.usage?.prompt_tokens),
      cacheHitTokens: count(
        data.usage?.prompt_cache_hit_tokens ?? data.usage?.prompt_tokens_details?.cached_tokens
      ),
      cacheMissTokens: count(data.usage?.prompt_cache_miss_tokens),
      completionTokens: count(data.usage?.completion_tokens),
      reasoningTokens: count(data.usage?.completion_tokens_details?.reasoning_tokens),
      totalTokens: count(data.usage?.total_tokens)
    };
    metric.finishReason = ['stop', 'length', 'content_filter', 'tool_calls'].includes(
      data?.choices?.[0]?.finish_reason
    )
      ? data.choices[0].finish_reason
      : 'unknown';
    if (typeof content !== 'string') {
      metric.status = 'missing_content';
      console.warn('DeepSeek API returned no message content');
      return null;
    }
    if (data?.choices?.[0]?.finish_reason === 'length') {
      metric.status = 'truncated';
      console.warn('DeepSeek API output was truncated');
      return null;
    }
    metric.status = 'invalid_choice';
    const result = JSON.parse(content),
      choice = result.choice;
    if (!Number.isInteger(choice) || choice < 0 || choice >= actions.length) {
      console.warn('DeepSeek API returned an invalid action choice');
      return null;
    }
    const saved = JSON.stringify({ choice });
    if (session?.messages)
      session.messages.push(decisionMessage, { role: 'assistant', content: saved });
    Object.assign(metric, { status: 'success', actionType: actions[choice].type, choice });
    onDecision?.({
      actionType: actions[choice].type,
      source: 'model',
      choice,
      candidates: actions.length
    });
    return actions[choice];
  } catch (error) {
    if (error?.name === 'AbortError') metric.status = 'timeout';
    console.warn('DeepSeek API request failed', error?.name || 'unknown error');
    return null;
  } finally {
    clearTimeout(timer);
    emit();
  }
}

function pCardKey(game, me, id) {
  return game.players[me].hand.find((c) => c.id === id)?.key;
}
