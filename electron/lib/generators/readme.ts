import type { Manifest } from "../schema.js";
import { nodesByKind } from "../schema.js";
import { NODE_REGISTRY, legendSvgFor } from "../../../shared/entity-registry.js";

/**
 * Generate a print-ready HTML document for the system.
 * Includes topology diagram (SVG), route table, safety parameters,
 * automation summary, and installation notes.
 *
 * User opens in browser → Print to PDF. Zero dependencies.
 * Also viewable in the Documentation tab within the app.
 */
export function generateDocumentation(m: Manifest, topologySvg: string): string {
  const tanks = nodesByKind(m.nodes, 'tank');
  const tanksWithLevel = tanks.filter(t => t['level_pin']);
  const pumps = nodesByKind(m.nodes, 'pump');
  const flowSensors = nodesByKind(m.nodes, 'flow_sensor');
  const valves = nodesByKind(m.nodes, 'valve');

  // Legend — unique entity kinds in this topology
  const usedKinds = [...new Set(m.nodes.map(n => n.kind))];
  const legendItems = usedKinds
    .map(kind => {
      const desc = NODE_REGISTRY.get(kind);
      if (!desc) return '';
      const svg = legendSvgFor(desc);
      return `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:16px;">${svg} <span>${desc.label}</span></span>`;
    })
    .filter(Boolean)
    .join('\n      ');

  // Route table rows
  const routeRows = m.routes.map(r => {
    const srcMin = r.source_min_pct > 0 ? `${r.source_min_pct}%` : '—';
    const dstMax = r.dest_max_pct > 0 ? `${r.dest_max_pct}%` : '—';
    const runtime = r.max_runtime_seconds >= 3600
      ? `${(r.max_runtime_seconds / 3600).toFixed(1)}h`
      : `${Math.round(r.max_runtime_seconds / 60)}m`;
    return `<tr>
      <td>${r.name}</td>
      <td>${r.needs_pump ? 'Pumped' : 'Gravity'}</td>
      <td>${srcMin}</td>
      <td>${dstMax}</td>
      <td>${runtime}</td>
      <td>${r.runtime_level_ok ? 'Yes' : 'No'}</td>
    </tr>`;
  }).join('\n');

  // Automation list
  const autoItems = m.automations
    .filter(a => a.name && a.enabled)
    .map(a => {
      const trigger = a.trigger.type === 'time'
        ? `Daily at ${a.trigger.at}`
        : `Level trigger`;
      const days = a.days_of_week.length === 7 ? 'Every day' : a.days_of_week.join(', ');
      return `<tr><td>${a.name}</td><td>${trigger}</td><td>${days}</td><td>${a.route_name}</td></tr>`;
    }).join('\n');

  // Component summary
  const components = [
    tanks.length > 0 ? `${tanks.length} tank${tanks.length > 1 ? 's' : ''}` : '',
    pumps.length > 0 ? `${pumps.length} pump${pumps.length > 1 ? 's' : ''}` : '',
    valves.length > 0 ? `${valves.length} valve${valves.length > 1 ? 's' : ''}` : '',
    flowSensors.length > 0 ? `${flowSensors.length} flow sensor${flowSensors.length > 1 ? 's' : ''}` : '',
  ].filter(Boolean).join(' · ');

  // Installation notes
  const installNotes: string[] = [];
  if (flowSensors.length > 0 && pumps.length > 0) {
    installNotes.push('<li><strong>10D/5D rule</strong> — flow sensors need 10 pipe diameters of straight pipe downstream of a pump, 5 diameters upstream of the next valve or fitting.</li>');
  }
  for (const t of tanks) {
    if (!t['pump_rated'] && t['level_pin']) {
      installNotes.push(`<li><strong>${t['name']}</strong> — level sensor not pump-rated. Readings are suppressed during pump operation. For runtime level monitoring, install a pressure transducer rated for in-line use.</li>`);
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${m.device.friendly_name} — System Documentation</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; max-width: 900px; margin: 0 auto; padding: 24px; font-size: 13px; line-height: 1.5; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  h2 { font-size: 15px; margin: 24px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #e5e5e5; }
  .subtitle { color: #666; font-size: 12px; margin-bottom: 16px; }
  .components { font-size: 12px; color: #555; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; font-size: 12px; }
  th, td { padding: 6px 10px; text-align: left; border: 1px solid #e5e5e5; }
  th { background: #f5f5f5; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.3px; }
  .diagram { margin: 12px 0; text-align: center; }
  .diagram svg { max-width: 100%; height: auto; border: 1px solid #e5e5e5; border-radius: 6px; background: #fafafa; }
  .safety-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 8px 0; }
  .safety-card { background: #f8f9fa; border: 1px solid #e5e5e5; border-radius: 6px; padding: 10px 12px; }
  .safety-card strong { display: block; font-size: 12px; margin-bottom: 2px; }
  .safety-card span { font-size: 11px; color: #666; }
  ul { padding-left: 20px; margin: 8px 0; }
  li { margin: 4px 0; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e5e5e5; font-size: 11px; color: #999; text-align: center; }
  @media print {
    body { padding: 0; }
    .diagram svg { border: none; }
    h2 { page-break-after: avoid; }
    table { page-break-inside: avoid; }
  }
</style>
</head>
<body>

<h1>${m.device.friendly_name}</h1>
<div class="subtitle">Water System Documentation · Generated by MajiFlow</div>
<div class="components">${components} · ${m.routes.length} route${m.routes.length !== 1 ? 's' : ''}</div>

<h2>Topology</h2>
<div class="diagram">
${topologySvg}
</div>
<div style="margin:8px 0 16px;font-size:12px;color:#555;display:flex;flex-wrap:wrap;align-items:center;gap:4px 0;">
      ${legendItems}
</div>

<h2>Routes</h2>
<table>
  <thead>
    <tr><th>Route</th><th>Type</th><th>Source Min</th><th>Dest Max</th><th>Max Runtime</th><th>Runtime Level</th></tr>
  </thead>
  <tbody>
${routeRows}
  </tbody>
</table>

${autoItems ? `<h2>Automations</h2>
<table>
  <thead>
    <tr><th>Name</th><th>Trigger</th><th>Schedule</th><th>Route</th></tr>
  </thead>
  <tbody>
${autoItems}
  </tbody>
</table>` : ''}

<h2>Home Assistant Entities</h2>
<p style="font-size:11px;color:#666;margin-bottom:8px;">These entities are created on the ESP32 and appear in HA automatically. Calibration and override values are adjustable from the HA UI.</p>
<table>
  <thead><tr><th>Entity</th><th>Type</th><th>Purpose</th></tr></thead>
  <tbody>
${m.routes.map((r, i) => `\
    <tr><td>button.…_start_${i}</td><td>Button</td><td>Start route: ${r.name}</td></tr>
    <tr><td>button.…_stop_${i}</td><td>Button</td><td>Stop route: ${r.name}</td></tr>`).join('\n')}
${tanksWithLevel.map(t => `\
    <tr><td>number.…_${t['id']}_cal_empty</td><td>Number</td><td>${t['name']} empty voltage calibration</td></tr>
    <tr><td>number.…_${t['id']}_cal_full</td><td>Number</td><td>${t['name']} full voltage calibration</td></tr>`).join('\n')}
    <tr><td>switch.…_safety_override</td><td>Switch</td><td>Bypass pre-start level checks (use with caution)</td></tr>
  </tbody>
</table>

<h2>Timing Parameters</h2>
<table>
  <thead><tr><th>Parameter</th><th>Value</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td>Valve travel time</td><td>${m.timing.valve_travel_time}</td><td>Time allowed for valves to fully open/close</td></tr>
    <tr><td>Flow watchdog</td><td>${m.timing.flow_watchdog_seconds}s</td><td>No-flow duration before fault/tank-full detection</td></tr>
    <tr><td>Flow confirm</td><td>${m.timing.flow_confirm_seconds}s</td><td>Time to confirm flow is established after start</td></tr>
    <tr><td>API watchdog</td><td>${m.timing.api_watchdog_seconds}s</td><td>HA disconnect duration before route is faulted</td></tr>
    <tr><td>Sensor update</td><td>${m.timing.update_interval}</td><td>ADC/sensor polling interval</td></tr>
  </tbody>
</table>

<h2>Firmware Safety</h2>
<div class="safety-grid">
  <div class="safety-card">
    <strong>Pre-start checks</strong>
    <span>Source/dest level thresholds enforced before every start (pump off, sensors reliable)</span>
  </div>
  <div class="safety-card">
    <strong>Flow watchdog</strong>
    <span>No-flow fault after ${m.timing.flow_watchdog_seconds}s · Flow confirmed within ${m.timing.flow_confirm_seconds}s</span>
  </div>
  <div class="safety-card">
    <strong>Runtime level</strong>
    <span>Active on routes with pump-rated sensors · Clean stop on threshold breach</span>
  </div>
  <div class="safety-card">
    <strong>API watchdog</strong>
    <span>Route faulted if HA disconnects for ${m.timing.api_watchdog_seconds}s</span>
  </div>
</div>

<h2>System Alerts</h2>
<ul>
  <li>Fault notification on any route entering FAULT state</li>
${tanksWithLevel.length >= 2 ? '  <li>Water critical alert when combined tank level drops below 35%</li>' : ''}
</ul>

${installNotes.length > 0 ? `<h2>Installation Notes</h2>
<ul>
${installNotes.join('\n')}
</ul>` : ''}

<div class="footer">
  ${m.device.friendly_name} · Board: ${m.device.board} · Generated ${new Date().toISOString().split('T')[0]}
</div>

</body>
</html>`;
}
