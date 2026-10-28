// Pointer Events keep mouse, pen and touch on the same gesture path.
export function mountCardDrag({ hand, map, canStart, validate, onStart, onHover, onDrop, onStop, onError }) {
  let gesture = null;
  let suppressClickUntil = 0;
  const inside = (x, y) => {
    const r = map.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };
  const clear = state => {
    cancelAnimationFrame(state.frame);
    gesture = null;
    if (hand.hasPointerCapture(state.pointerId)) hand.releasePointerCapture(state.pointerId);
    document.body.classList.remove('card-is-dragging');
    onHover(false);
  };
  function draw() {
    const s = gesture;
    if (!s?.dragging) return;
    s.ghost.style.transform = `translate3d(${s.x - s.offsetX}px,${s.y - s.offsetY}px,0) rotate(-4deg) scale(1.03)`;
    const over = inside(s.x, s.y);
    if (s.over !== over) { s.over = over; onHover(over); }
    const edge = 58;
    if (s.y < edge) window.scrollBy(0, -Math.ceil((edge - s.y) / 5));
    else if (s.y > innerHeight - edge) window.scrollBy(0, Math.ceil((s.y - innerHeight + edge) / 5));
    s.frame = requestAnimationFrame(draw);
  }
  function cancel() {
    const s = gesture;
    if (!s) return;
    clear(s);
    s.card.classList.remove('drag-origin');
    s.ghost?.remove();
    if (s.dragging) { suppressClickUntil = performance.now() + 550; onStop(); }
  }
  async function release(event) {
    const s = gesture;
    if (!s || event.pointerId !== s.pointerId) return;
    if (!s.dragging) { clear(s); return; }
    event.preventDefault();
    suppressClickUntil = performance.now() + 650;
    const accepted = inside(event.clientX, event.clientY);
    const from = s.ghost.getBoundingClientRect().toJSON();
    clear(s);
    if (accepted) {
      s.card.classList.remove('drag-origin');
      s.ghost.remove();
      onStop();
      onDrop(s.id, from);
      return;
    }
    const home = s.card.getBoundingClientRect();
    try {
      const a = s.ghost.animate([
        { transform: s.ghost.style.transform, opacity: 1 },
        { transform: `translate3d(${home.left}px,${home.top}px,0) rotate(0deg) scale(1)`, opacity: .8 }
      ], { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 230, easing: 'ease-out', fill: 'forwards' });
      await a.finished;
    } finally {
      s.card.classList.remove('drag-origin');
      s.ghost.remove();
      onStop();
    }
  }
  hand.addEventListener('pointerdown', event => {
    if (gesture || !event.isPrimary || event.button !== 0) return;
    const card = event.target.closest('button[data-card-id]');
    if (!card || !canStart(card.dataset.cardId)) return;
    const r = card.getBoundingClientRect();
    gesture = { id: card.dataset.cardId, card, pointerId: event.pointerId, pointerType: event.pointerType, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, offsetX: event.clientX - r.left, offsetY: event.clientY - r.top, rect: r, dragging: false, over: false };
  });
  window.addEventListener('pointermove', event => {
    const s = gesture;
    if (!s || event.pointerId !== s.pointerId) return;
    s.x = event.clientX; s.y = event.clientY;
    if (!s.dragging && Math.hypot(s.x - s.startX, s.y - s.startY) < 8) return;
    if (!s.dragging && s.pointerType === 'touch' && Math.abs(s.x - s.startX) > Math.abs(s.y - s.startY) * 1.2) {
      suppressClickUntil = performance.now() + 550;
      clear(s);
      return;
    }
    if (!s.dragging) {
      try { validate(s.id); } catch (error) { suppressClickUntil = performance.now() + 650; clear(s); onError(error.message); return; }
      s.dragging = true;
      hand.setPointerCapture(event.pointerId);
      s.ghost = s.card.cloneNode(true);
      s.ghost.classList.add('drag-card');
      s.ghost.setAttribute('aria-hidden', 'true');
      s.ghost.tabIndex = -1;
      s.ghost.removeAttribute('data-card-id');
      s.ghost.style.width = s.rect.width + 'px';
      s.ghost.style.height = s.rect.height + 'px';
      document.querySelector('#flight-layer').append(s.ghost);
      s.card.classList.add('drag-origin');
      document.body.classList.add('card-is-dragging');
      onStart(s.id);
      draw();
    }
    event.preventDefault();
  }, { passive: false });
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', cancel);
  hand.addEventListener('lostpointercapture', event => { if (event.target === hand && gesture) cancel(); });
  hand.addEventListener('click', event => {
    if (performance.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  hand.addEventListener('dragstart', event => event.preventDefault());
  window.addEventListener('blur', cancel);
  window.addEventListener('resize', cancel);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
  return { cancel };
}
