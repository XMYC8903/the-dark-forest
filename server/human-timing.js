// Timers are authoritative server state, keyed by seat so broadcast responses
// can run concurrently without resetting when another player acts.
export function syncHumanTimers(room, now = Date.now()) {
  const game = room.game;
  const old = room.humanTimers || {},
    next = {};
  if (room.status === 'playing' && game && !game.over) {
    const pending = game.pending;
    const add = (id, phase, key, duration) => {
      const member = room.members[id];
      if (!member || member.bot || member.exited || !game.players[id]?.alive) return;
      next[id] =
        old[id]?.key === key
          ? old[id]
          : { id: crypto.randomUUID(), key, phase, deadline: now + duration };
    };
    if (pending?.kind === 'escape') {
      add(pending.victim, 'escape', `escape:${pending.strikeId}`, 10000);
    } else if (pending?.kind === 'broadcast' && !pending.autoSettleAt) {
      const waiting = game.players.filter(
        (p) => p.alive && p.id !== pending.caster && !pending.decisions.includes(p.id)
      );
      if (waiting.length)
        for (const player of waiting)
          add(player.id, 'respond', `respond:${pending.publicId}:${player.id}`, 10000);
      else add(pending.caster, 'settle', `settle:${pending.publicId}`, 10000);
    } else if (!pending) {
      add(game.active, 'turn', `turn:${game.turnIndex}:${game.active}`, 30000);
    }
  }
  room.humanTimers = next;
  return Math.min(Infinity, ...Object.values(next).map((timer) => timer.deadline));
}

export function humanTimeoutAction(room, seat, rng = Math.random) {
  const game = room.game,
    timer = room.humanTimers?.[seat];
  if (!timer) return null;
  if (timer.phase === 'turn') return { type: 'end' };
  if (timer.phase === 'escape') return { type: 'escape', use: false };
  if (timer.phase === 'settle')
    return { type: 'settle', chosen: game.pending.responses[0]?.actor ?? null };
  if (timer.phase === 'respond') {
    const options = game.isForced(seat) ? game.responseOptions(seat) : [];
    const card = options[Math.floor(rng() * options.length)];
    return card ? { type: 'respond', cardId: card.id } : { type: 'respond' };
  }
  return null;
}
