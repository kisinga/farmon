import { SensorNodeData, CompareNodeData, LogicGateNodeData, ActionNodeData, TimeWindowNodeData } from './visual-rules.types';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function sensorNodeHtml(data: SensorNodeData): string {
  return `
    <div class="node-body node-sensor">
      <div class="node-title">Sensor</div>
      <div class="node-label">${esc(data.label || `Field ${data.field_idx}`)}</div>
    </div>`;
}

export function compareNodeHtml(data: CompareNodeData): string {
  const tag = data.is_primary ? 'primary' : 'extra';
  return `
    <div class="node-body node-compare">
      <div class="node-title">Compare <span class="node-tag">${tag}</span></div>
      <div class="node-label">${esc(data.operator)} ${data.threshold}</div>
    </div>`;
}

export function logicGateNodeHtml(data: LogicGateNodeData): string {
  return `
    <div class="node-body node-logic">
      <div class="node-title">Logic</div>
      <div class="node-label node-gate-label">${data.logic.toUpperCase()}</div>
    </div>`;
}

export function actionNodeHtml(data: ActionNodeData): string {
  return `
    <div class="node-body node-action">
      <div class="node-title">Action</div>
      <div class="node-label">${esc(data.label || `Ctrl ${data.control_idx}`)}</div>
      <div class="node-meta">State &rarr; ${data.action_state}</div>
    </div>`;
}

export function timeWindowNodeHtml(data: TimeWindowNodeData): string {
  const fmt = (h: number) => `${h.toString().padStart(2, '0')}:00`;
  return `
    <div class="node-body node-time">
      <div class="node-title">Time Window</div>
      <div class="node-label">${fmt(data.time_start)} &ndash; ${fmt(data.time_end)}</div>
    </div>`;
}

export function nodeHtmlFor(data: { type: string }): string {
  switch (data.type) {
    case 'sensor':      return sensorNodeHtml(data as SensorNodeData);
    case 'compare':     return compareNodeHtml(data as CompareNodeData);
    case 'logic_gate':  return logicGateNodeHtml(data as LogicGateNodeData);
    case 'action':      return actionNodeHtml(data as ActionNodeData);
    case 'time_window': return timeWindowNodeHtml(data as TimeWindowNodeData);
    default:            return `<div class="node-body">Unknown</div>`;
  }
}
