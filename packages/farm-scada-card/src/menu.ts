/**
 * Long-press / right-click detection + menu positioning.
 *
 * Long-press: pointerdown held for >=400ms without moving >8px counts.
 * Position: we convert the node group's bbox to screen coords via
 * `getScreenCTM` so the menu lands crisply in CSS pixel space, not scaled.
 */

export interface MenuPosition { x: number; y: number }

const LONG_PRESS_MS = 400;
const MOVE_CANCEL_PX = 8;

export interface PointerMenuHandlers {
  onMenu(nodeId: string, pos: MenuPosition): void;
  /** Called to clear any open menu on a blank click. */
  onDismiss(): void;
}

/**
 * Install pointer/context/touch listeners on an SVG root. Returns an
 * unsubscribe function.
 */
export function installMenuListeners(root: SVGSVGElement, handlers: PointerMenuHandlers): () => void {
  const state = { t: 0, x: 0, y: 0, nodeId: null as string | null, timer: 0 };

  const cancel = () => {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = 0;
    }
    state.nodeId = null;
  };

  const onPointerDown = (ev: PointerEvent) => {
    const g = findNodeGroup(ev.target as Element | null);
    if (!g) return;
    const nodeId = g.getAttribute('data-node-id');
    if (!nodeId) return;
    state.t = performance.now();
    state.x = ev.clientX;
    state.y = ev.clientY;
    state.nodeId = nodeId;
    state.timer = window.setTimeout(() => {
      if (state.nodeId) {
        const pos = nodeScreenPos(g, root) ?? { x: ev.clientX, y: ev.clientY };
        handlers.onMenu(state.nodeId, pos);
        cancel();
      }
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (ev: PointerEvent) => {
    if (!state.nodeId) return;
    const dx = ev.clientX - state.x;
    const dy = ev.clientY - state.y;
    if (dx * dx + dy * dy > MOVE_CANCEL_PX * MOVE_CANCEL_PX) cancel();
  };

  const onPointerUp = () => cancel();
  const onPointerCancel = () => cancel();

  const onContextMenu = (ev: MouseEvent) => {
    const g = findNodeGroup(ev.target as Element | null);
    if (!g) return;
    const nodeId = g.getAttribute('data-node-id');
    if (!nodeId) return;
    ev.preventDefault();
    const pos = nodeScreenPos(g, root) ?? { x: ev.clientX, y: ev.clientY };
    handlers.onMenu(nodeId, pos);
  };

  const onBlankClick = (ev: MouseEvent) => {
    if (!findNodeGroup(ev.target as Element | null)) {
      handlers.onDismiss();
    }
  };

  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerCancel);
  root.addEventListener('contextmenu', onContextMenu);
  root.addEventListener('click', onBlankClick);

  return () => {
    cancel();
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('pointermove', onPointerMove);
    root.removeEventListener('pointerup', onPointerUp);
    root.removeEventListener('pointercancel', onPointerCancel);
    root.removeEventListener('contextmenu', onContextMenu);
    root.removeEventListener('click', onBlankClick);
  };
}

function findNodeGroup(el: Element | null): SVGGElement | null {
  if (!el) return null;
  const hit = (el as Element).closest?.('[data-node-id]') as SVGGElement | null;
  return hit ?? null;
}

/**
 * Convert the top-left corner of a node `<g>`'s local bbox into screen coords.
 * Returns null if the SVG has no CTM (not yet laid out).
 */
function nodeScreenPos(g: SVGGraphicsElement, _root: SVGSVGElement): MenuPosition | null {
  const ctm = g.getScreenCTM();
  if (!ctm) return null;
  const bbox = g.getBBox();
  const x = ctm.a * bbox.x + ctm.c * bbox.y + ctm.e;
  const y = ctm.b * bbox.x + ctm.d * bbox.y + ctm.f;
  return { x, y };
}
