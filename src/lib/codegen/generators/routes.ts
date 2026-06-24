import type { Manifest } from '@core';
import { nodesByKind, nodesWithFlag, allNodes, pumpSwitchId, routeVolumeEligible, routeSetVersion } from '@core';
import { valveCoverId, valveTravelTimeId, pressureSensorLevelId, flowSensorId, flowTotalId } from '@core';

// ---------------------------------------------------------------------------
// Route context — pure computation, platform-agnostic
// ---------------------------------------------------------------------------

export interface RouteContext {
  manifest: Manifest;
  tanks: Array<Manifest['nodes'][number] | Manifest['imports'][number]>;
  valves: Array<Manifest['nodes'][number] | Manifest['imports'][number]>;
  flowSensors: Array<Manifest['nodes'][number] | Manifest['imports'][number]>;
  waterSources: Array<Manifest['nodes'][number] | Manifest['imports'][number]>;
  pumps: Array<Manifest['nodes'][number] | Manifest['imports'][number]>;
  tankIdx: Map<string, number>;
  valveIdx: Map<string, number>;
  flowIdx: Map<string, number>;
  wsIdx: Map<string, number>;
  pumpIdx: Map<string, number>;
  valveTravelMs: number;
  flowWatchdogMs: number;
  flowConfirmMs: number;
  conflictMasks: number[];
  routeLines: string[];
  valveComment: string;
  tankComment: string;
  wsComment: string;
  flowComment: string;
  pumpComment: string;
}

/**
 * Build a RouteContext from a manifest.
 * Pure function — all index computation, conflict masks, and route table
 * formatting lives here. Platform-specific emission is separate.
 */
export function buildRouteContext(m: Manifest): RouteContext {
  const all = allNodes(m);
  const tanks = nodesByKind(all, 'tank');
  const valves = nodesWithFlag(all, 'isValve');
  const flowSensors = nodesWithFlag(all, 'isFlowSensor');
  const waterSources = nodesByKind(all, 'water_source');
  const pumps = nodesWithFlag(all, 'isPump');

  const tankIdx = new Map(tanks.map((t, i) => [t['id'], i]));
  const valveIdx = new Map(valves.map((v, i) => [v['id'], i]));
  const flowIdx = new Map(flowSensors.map((f, i) => [f['id'], i]));
  const wsIdx = new Map(waterSources.map((ws, i) => [ws['id'], i]));
  const pumpIdx = new Map(pumps.map((p, i) => [p['id'], i]));

  // Timing constants
  const valveTravelMs = m.timing.valve_travel_time * 1000;
  const flowWatchdogMs = m.timing.flow_watchdog * 1000;
  const flowConfirmMs = m.timing.flow_confirm * 1000;

  // Compute conflict masks — routes that share a flow sensor are mutually
  // exclusive: one meter measures one pipe, so two routes can never push flow
  // through it at once (a concurrent second flow would make each route's delivered
  // volume ambiguous). Destination is irrelevant — sharing the meter is the
  // conflict. This is what lets every metered route offer a volume target.
  const conflictMasks = m.routes.map((r, i) => {
    let mask = 0;
    // Unmonitored routes (no flow sensor) never conflict — nothing to share.
    if (!r.flow_sensor) return mask;
    for (let j = 0; j < m.routes.length; j++) {
      if (i === j) continue;
      if (m.routes[j].flow_sensor === r.flow_sensor) mask |= (1 << j);
    }
    return mask;
  });

  // Build route entries
  const routeLines = m.routes.map((r, i) => {
    const mask = r.valves.reduce((acc, v) => acc | (1 << valveIdx.get(v)!), 0);
    const srcTank = r.source_type === "tank" ? tankIdx.get(r.source)! : "0xFF";
    const srcWs = r.source_type === "water_source" ? wsIdx.get(r.source)! : "0xFF";
    const dst = r.destination ? tankIdx.get(r.destination)! : "0xFF";
    const flow = r.flow_sensor !== undefined ? flowIdx.get(r.flow_sensor)! : "0xFF";
    const maskBin = mask.toString(2).padStart(valves.length, "0");
    const conflictBin = conflictMasks[i].toString(2).padStart(m.routes.length, "0");
    const pump = r.crossesPump ? (pumpIdx.get(r.nodeSequence[r.pumpIndex]) ?? "0xFF") : "0xFF";
    const srcMin = r.source_min_pct ?? 0;
    const dstMax = r.dest_max_pct ?? 0;
    const rtLvl = r.runtime_level_ok ? "true" : "false";
    return `  { ${i}, 0b${maskBin}, ${srcTank}, ${srcWs}, ${dst}, ${flow}, 0b${conflictBin}, ${r.max_runtime_seconds}, ${pump}, ${srcMin}, ${dstMax}, ${rtLvl}, "${r.name}" },`;
  });

  // Build index comments
  const valveComment = valves.map((v, i) => `${i}=${v['id']}(${v['name']})`).join("  ");
  const tankComment = tanks.map((t, i) => `${i}=${t['id']}(${t['name']})`).join("  ");
  const wsComment = waterSources.map((ws, i) => `${i}=${ws['id']}(${ws['name']})`).join("  ");
  const flowComment = flowSensors.map((f, i) => `${i}=${f['id']}(${f['name']})`).join("  ");
  const pumpComment = pumps.map((p, i) => `${i}=${p['id']}(${p['name']})`).join("  ");

  return {
    manifest: m,
    tanks, valves, flowSensors, waterSources, pumps,
    tankIdx, valveIdx, flowIdx, wsIdx, pumpIdx,
    valveTravelMs, flowWatchdogMs, flowConfirmMs,
    conflictMasks, routeLines,
    valveComment, tankComment, wsComment, flowComment, pumpComment,
  };
}

/** The manual / claim-driven pump rows (local pumps), derived from their routes. */
function manualPumpRows(m: Manifest, ctx: RouteContext): ManualPumpRow[] {
  const localFlowIds = new Set(nodesWithFlag(m.nodes, 'isFlowSensor').map((f) => f['id']));
  const localPumps = nodesWithFlag(m.nodes, 'isPump');
  return localPumps.map((p) => {
    const routesUsing = m.routes.filter((r) => r.crossesPump && r.nodeSequence[r.pumpIndex] === p['id']);
    let flowMask = 0;
    for (const r of routesUsing) {
      if (r.flow_sensor && localFlowIds.has(r.flow_sensor)) flowMask |= 1 << ctx.flowIdx.get(r.flow_sensor)!;
    }
    const srcSet = new Set(routesUsing.filter((r) => r.source_type === 'tank' && r.source_has_level).map((r) => r.source));
    let srcTank = '0xFF';
    let srcMin = 0;
    if (srcSet.size === 1) {
      const t = [...srcSet][0];
      srcTank = String(ctx.tankIdx.get(t)!);
      srcMin = Math.max(0, ...routesUsing.filter((r) => r.source === t).map((r) => r.source_min_pct ?? 0));
    }
    const maxRtS = routesUsing.length ? Math.max(...routesUsing.map((r) => r.max_runtime_seconds)) : 1800;
    return { nodeId: p['id'], relayIdx: ctx.pumpIdx.get(p['id'])!, flowMask, srcTank, srcMin, maxRtMs: maxRtS * 1000 };
  });
}

/**
 * Emit the `maji_control:` config — the route table + every entity binding the
 * maji_control component snapshots each tick. The decision logic lives in the
 * component (firmware/components/maji_control); this is DATA + use_id bindings only,
 * idx-aligned with the component's tables. Replaces the old generated routes.h.
 */
export function generateMajiControlConfig(m: Manifest): string {
  const ctx = buildRouteContext(m);
  const { tanks, valves, flowSensors, valveTravelMs, flowWatchdogMs, flowConfirmMs, conflictMasks } = ctx;
  const nid = (node: { id: string }) => ({ id: node.id });

  const tankItems = tanks.map((t) => {
    if (t['remoteSourceRef']) return `    - { sensor: ri_${t['id']} }`;
    if (!t['level_monitored']) return `    - {}`;  // unmonitored -> null handle (-1.0f)
    return `    - { sensor: ${pressureSensorLevelId(nid(t))} }`;
  });
  const flowItems = flowSensors.map((f) =>
    f['remoteSourceRef']
      ? `    - { rate: ri_${f['id']} }`  // remote: no local total
      : `    - { rate: ${flowSensorId(nid(f))}, total: ${flowTotalId(nid(f))} }`);
  const valveItems = valves.map((v) => `    - { cover: ${valveCoverId(nid(v))}, travel_id: ${valveTravelTimeId(nid(v))} }`);
  // LOCAL pump relays only — idx-aligned with pump_idx because local pumps lead pumpIdx.
  // Imported pumps have no local relay (they're proxied) and no local route crosses them.
  const pumpItems = nodesWithFlag(m.nodes, 'isPump').map((p) => `    - ${pumpSwitchId(p['id'])}`);

  const routeItems = m.routes.map((r, i) => {
    const mask = r.valves.reduce((acc, v) => acc | (1 << ctx.valveIdx.get(v)!), 0);
    const srcTank = r.source_type === 'tank' ? ctx.tankIdx.get(r.source)! : 255;
    const srcWs = r.source_type === 'water_source' ? ctx.wsIdx.get(r.source)! : 255;
    const dst = r.destination ? ctx.tankIdx.get(r.destination)! : 255;
    const flow = r.flow_sensor !== undefined ? ctx.flowIdx.get(r.flow_sensor)! : 255;
    const pump = r.crossesPump ? (ctx.pumpIdx.get(r.nodeSequence[r.pumpIndex]) ?? 255) : 255;
    const f = [
      `id: ${i}`, `valve_mask: ${mask}`, `source_tank: ${srcTank}`, `source_ws: ${srcWs}`,
      `dest_tank: ${dst}`, `flow_sensor: ${flow}`, `conflict_mask: ${conflictMasks[i]}`,
      `max_runtime_s: ${r.max_runtime_seconds}`, `pump_idx: ${pump}`,
      `source_min_pct: ${r.source_min_pct ?? 0}`, `dest_max_pct: ${r.dest_max_pct ?? 0}`,
      `runtime_level_ok: ${r.runtime_level_ok ? 'true' : 'false'}`, `name: ${JSON.stringify(r.name)}`,
      `max_runtime_id: route_${i}_max_runtime`, `target_duration_id: route_${i}_target_duration_s`,
    ];
    if (routeVolumeEligible(r)) f.push(`target_volume_id: route_${i}_target_volume_l`);
    if (r.source_has_level) f.push(`source_min_id: route_${i}_source_min_pct`);
    if (r.dest_has_level) f.push(`dest_max_id: route_${i}_dest_max_pct`);
    if (r.flow_sensor) f.push(`flow_stall_id: route_${i}_flow_stall_enable`);
    return `    - { ${f.join(', ')} }`;
  });

  const mpItems = manualPumpRows(m, ctx).map((r) => {
    const src = r.srcTank === '0xFF' ? 255 : r.srcTank;
    return `    - { node_id: "${r.nodeId}", relay_idx: ${r.relayIdx}, flow_mask: ${r.flowMask}, src_tank: ${src}, src_min: ${r.srcMin}, max_rt_ms: ${r.maxRtMs} }`;
  });

  const list = (items: string[]) => (items.length ? '\n' + items.join('\n') : ' []');

  return `# =============================================================================
# MajiFlow — Route Control Engine (config)
# =============================================================================
# AUTO-GENERATED. The route table + entity bindings the maji_control component
# snapshots each tick. ALL decision logic (state machine, watchdog, pump guard)
# lives in the vendored maji_control external component — this is data only.
# =============================================================================

maji_control:
  id: control
  claims_id: claims
  safety_override_id: safety_override
  flow_watchdog_id: flow_watchdog_s
  flow_confirm_id: flow_confirm_s
  flow_threshold_id: flow_threshold_l_min
  defaults:
    flow_watchdog_ms: ${flowWatchdogMs}
    flow_confirm_ms: ${flowConfirmMs}
    flow_threshold: ${m.timing.flow_threshold ?? 1}
    valve_travel_ms: ${valveTravelMs}
  tanks:${list(tankItems)}
  flows:${list(flowItems)}
  valves:${list(valveItems)}
  pumps:${list(pumpItems)}
  routes:${list(routeItems)}
  manual_pumps:${list(mpItems)}
`;
}

// ---------------------------------------------------------------------------
// ESPHome-specific emission
// ---------------------------------------------------------------------------

interface ManualPumpRow {
  nodeId: string; relayIdx: number; flowMask: number; srcTank: string; srcMin: number; maxRtMs: number;
}
