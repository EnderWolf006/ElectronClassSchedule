// HTML5 Drag and Drop API 只响应鼠标，触屏不会触发 dragstart/dragover/drop。
// 这里基于 Pointer Events 实现一套等价的触屏（及手写笔）拖拽手势：
// 超过阈值才算拖拽，阈值内的点按不影响原有 click；
// 激活后通过 elementFromPoint 自行命中放置目标。

export function beginPointerGesture(event, {
  threshold = 6,
  onActivate,
  onMove,
  onEnd,
} = {}) {
  if (event.pointerType === 'mouse') return null;
  const pointerId = event.pointerId;
  const startX = event.clientX;
  const startY = event.clientY;
  let active = false;

  const cleanup = () => {
    window.removeEventListener('pointermove', handleMove);
    window.removeEventListener('pointerup', handleUp);
    window.removeEventListener('pointercancel', handleCancel);
  };

  const handleMove = (ev) => {
    if (ev.pointerId !== pointerId) return;
    if (!active) {
      if (Math.abs(ev.clientX - startX) < threshold
        && Math.abs(ev.clientY - startY) < threshold) {
        return;
      }
      active = true;
      onActivate?.({ x: ev.clientX, y: ev.clientY, event: ev });
    }
    // 阻止触屏滚动/下拉刷新，保证拖拽跟手
    ev.preventDefault();
    onMove?.({ x: ev.clientX, y: ev.clientY, event: ev });
  };

  const handleUp = (ev) => {
    if (ev.pointerId !== pointerId) return;
    const wasActive = active;
    cleanup();
    if (wasActive) onEnd?.({ x: ev.clientX, y: ev.clientY, event: ev, canceled: false });
  };

  const handleCancel = (ev) => {
    if (ev.pointerId !== pointerId) return;
    const wasActive = active;
    cleanup();
    if (wasActive) onEnd?.({ x: ev.clientX, y: ev.clientY, event: ev, canceled: true });
  };

  window.addEventListener('pointermove', handleMove, { passive: false });
  window.addEventListener('pointerup', handleUp);
  window.addEventListener('pointercancel', handleCancel);

  return {
    cancel: cleanup,
    isActive: () => active,
  };
}

// 生成一个跟随手指的拖影（克隆源节点），返回移动与销毁方法
export function createDragGhost(sourceEl) {
  const rect = sourceEl.getBoundingClientRect();
  const ghost = sourceEl.cloneNode(true);
  Object.assign(ghost.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: `${rect.width}px`,
    margin: '0',
    zIndex: '9999',
    pointerEvents: 'none',
    opacity: '0.9',
    transform: `translate3d(${rect.left}px, ${rect.top}px, 0) rotate(1.5deg) scale(1.03)`,
    boxShadow: '0 10px 28px rgba(0, 0, 0, 0.28)',
  });
  document.body.appendChild(ghost);
  return {
    move(x, y) {
      ghost.style.transform = `translate3d(${x - rect.width / 2}px, ${y - 12}px, 0) rotate(1.5deg) scale(1.03)`;
    },
    dispose() {
      ghost.remove();
    },
  };
}
