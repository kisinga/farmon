/**
 * Composes the self-test HA dashboard from active probes.
 */

import { stringify } from 'yaml';
import type { BoardDef } from '../board.js';
import type { TestProbe } from './probe.js';
import { deriveHaEntityId, systemHaEntityIds, networkHaEntityIds, batteryHaEntityIds } from '@far-mon/core';

export function generateDashboard(board: BoardDef, probes: TestProbe[]): string {
  // Mirrors self-test/device-yaml.ts: name = `selftest-<model>`, friendly_name = `<label> Self-Test`.
  // HA derives entity_ids from friendly_name; we pass the same device shape here.
  const model = board.model.replace('_', '-');
  const device = { name: `selftest-${model}`, friendly_name: `${board.label} Self-Test` };
  const e = (domain: string, name: string) => deriveHaEntityId(domain, device, name);
  // Diagnostics gated by board capabilities — SSOT with main system dashboards.
  // Self-test runs without a network config, so transport defaults follow board support.
  const sys = systemHaEntityIds(device, []);
  const net = networkHaEntityIds(device, undefined, board);
  const bat = batteryHaEntityIds(device, board);

  const overviewSection = {
    type: 'grid',
    cards: [
      {
        type: 'gauge', entity: e('sensor', 'Test Progress'), name: 'Test Progress',
        min: 0, max: 100, severity: { red: 0, yellow: 50, green: 90 }, needle: true,
        grid_options: { columns: 6, rows: 3 },
      },
      {
        type: 'entities', title: 'Test Control', state_color: true,
        entities: [
          { entity: e('binary_sensor', 'All Tests Passed'), name: 'Overall Result' },
          { entity: e('sensor', 'Test Progress'), name: 'Progress' },
          { entity: e('text_sensor', 'Test Phase'), name: 'Current Phase' },
        ],
        grid_options: { columns: 6, rows: 'auto' },
      },
      {
        type: 'button', entity: e('button', 'Run Tests'), name: 'Run Tests',
        icon: 'mdi:play-circle-outline', show_state: false,
        tap_action: { action: 'call-service', service: 'button.press', target: { entity_id: e('button', 'Run Tests') } },
        grid_options: { columns: 4, rows: 2 },
      },
    ],
    column_span: 1,
  };

  const resultsSection = {
    type: 'grid',
    cards: [{
      type: 'entities', title: 'Test Results', state_color: true,
      entities: probes.map(p => ({ entity: e('binary_sensor', p.label), name: p.label })),
      grid_options: { columns: 'full' },
    }],
    column_span: 1,
  };

  const detailSection = {
    type: 'grid',
    cards: [{
      type: 'entities', title: 'Test Details',
      entities: probes.map(p => ({ entity: e('text_sensor', `${p.label} Detail`), name: p.label })),
      grid_options: { columns: 'full' },
    }],
    column_span: 1,
  };

  const logSection = {
    type: 'grid',
    cards: [{
      type: 'markdown', title: 'Test Log',
      content: `{{ states('${e('text_sensor', 'Test Log')}') }}`,
      grid_options: { columns: 'full' },
    }],
    column_span: 1,
  };

  const healthEntities: Array<{ entity: string; name: string }> = [];
  if (net) healthEntities.push({ entity: net.wifiSignal, name: 'WiFi' });
  healthEntities.push(
    { entity: sys.esp32Temperature, name: 'Temp' },
    { entity: sys.uptime, name: 'Uptime' },
  );
  if (bat) healthEntities.push({ entity: bat.batteryPercent, name: 'Battery' });

  const healthSection = {
    type: 'grid',
    cards: [{
      type: 'glance', title: 'Device Health', show_state: true, entities: healthEntities,
      grid_options: { columns: 'full' },
    }],
    column_span: 1,
  };

  const dashboard = {
    title: `${board.label} Self-Test`,
    views: [{
      title: 'Self-Test', icon: 'mdi:test-tube', type: 'sections',
      sections: [overviewSection, resultsSection, detailSection, logSection, healthSection],
      badges: [], cards: [],
    }],
  };

  const header = [
    '# =============================================================================',
    `# ${board.label} — Self-Test Dashboard`,
    '# =============================================================================',
    '# AUTO-GENERATED from board definition. Do not edit by hand.',
    '# =============================================================================',
    '',
  ].join('\n');

  return header + stringify(dashboard, { indent: 2, lineWidth: 0, defaultStringType: 'PLAIN' });
}
