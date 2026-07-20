/**
 * Panel-button mapping — the single resolution rule shared by the firmware
 * codegen (generators/local-inputs.ts), the site manual (docs/assemble.ts),
 * and the editor (config-tab), so all three always agree on which physical
 * input drives which action.
 *
 * Default (product requirement): when a controller carries no explicit
 * `local.buttons` mapping and the board has input expanders, Stop All takes
 * the FIRST input (IN1 — the safety control gets the most prominent
 * position) and routes in manifest order auto-assign to IN2..IN(n+1).
 *
 * An explicit mapping overrides the defaults entirely, with one safety
 * exception: Stop All is always kept available — when an explicit mapping
 * omits it, it is backfilled on the first UNASSIGNED input (IN1 when free).
 *
 * Route buttons are TOGGLES (press = start, press again = stop); the
 * on_press lambda lives in the codegen generator.
 */
import type { BoardDef } from './board.types';
import type { ControllerLocal } from './topology.types';
import type { Manifest } from './manifest.types';

/** One resolved physical-button → action assignment (defaults applied). */
export interface ButtonAssignment {
  /** Board input pin gpio, e.g. 'IN1'. */
  input: string;
  action: 'route_start' | 'stop_all';
  /** Index into the manifest route table (== firmware route id); -1 for stop_all. */
  routeIndex: number;
  /** Route display name; '' for stop_all. */
  routeName: string;
}

/**
 * Board input-expander pin gpios in board-definition order ('IN1'…'IN16'),
 * [] when the board has no input expanders. Input expanders are the ones
 * whose id carries an `in` token ('pcf8574_in_1'), mirroring the board
 * definitions' `_in_`/`_out_` naming convention.
 */
export function boardInputPins(board: BoardDef): string[] {
  const inputExpanders = new Set(
    (board.expanders ?? []).filter(e => e.id.split('_').includes('in')).map(e => e.id),
  );
  return board.pins
    .filter(p => p.expander != null && inputExpanders.has(p.expander))
    .map(p => p.gpio);
}

/**
 * Cheap predicate: would generateLocalInputs emit anything for this
 * manifest/board pair? Mirrors its two null cases (no input expanders, no
 * resolvable assignments) without rendering the YAML — used to gate the
 * device-YAML package include without generating the block twice.
 */
export function hasLocalInputs(m: Manifest, board: BoardDef): boolean {
  const pins = boardInputPins(board);
  return pins.length > 0 && resolveButtonAssignments(m.routes, pins, m.device.local).length > 0;
}

/**
 * Resolve the effective button assignments for a controller: its explicit
 * `local.buttons` mapping when present (non-empty), otherwise the default
 * auto-assign (Stop All on IN1, routes in order after it). Unknown inputs
 * and unresolvable route keys are dropped; the first entry wins on a
 * duplicate input.
 */
export function resolveButtonAssignments(
  routes: ReadonlyArray<{ key: string; name: string }>,
  inputPins: readonly string[],
  local?: ControllerLocal,
): ButtonAssignment[] {
  const out: ButtonAssignment[] = [];
  const seenInputs = new Set<string>();
  const push = (a: ButtonAssignment) => {
    if (seenInputs.has(a.input)) return;
    seenInputs.add(a.input);
    out.push(a);
  };

  const buttons = local?.buttons;
  if (buttons && buttons.length > 0) {
    for (const b of buttons) {
      if (!inputPins.includes(b.input)) continue;
      if (b.action === 'stop_all') {
        push({ input: b.input, action: 'stop_all', routeIndex: -1, routeName: '' });
        continue;
      }
      const idx = routes.findIndex(r => r.key === b.route);
      if (idx < 0) continue;
      push({ input: b.input, action: 'route_start', routeIndex: idx, routeName: routes[idx].name });
    }
    // Stop All stays available even under an explicit mapping: backfill it on
    // the first input the mapping left unassigned (IN1 preferred when free).
    // A mapping that takes IN1 for a route must NOT silently ship a panel with
    // no Stop All.
    if (!out.some(a => a.action === 'stop_all') && inputPins.length > 0) {
      const free = inputPins.find(p => !seenInputs.has(p));
      if (free) push({ input: free, action: 'stop_all', routeIndex: -1, routeName: '' });
    }
    return out;
  }

  // Default auto-assign: Stop All on the first input, routes in order after it.
  if (inputPins.length === 0) return out;
  push({ input: inputPins[0], action: 'stop_all', routeIndex: -1, routeName: '' });
  const n = Math.min(routes.length, inputPins.length - 1);
  for (let i = 0; i < n; i++) {
    push({ input: inputPins[i + 1], action: 'route_start', routeIndex: i, routeName: routes[i].name });
  }
  return out;
}
