import { DeviceField, DeviceControl, DeviceRuleRecord, ExtraCondition } from '../../../core/services/api.types';
import {
  VisualNodeData, SensorNodeData, CompareNodeData, LogicGateNodeData,
  ActionNodeData, TimeWindowNodeData,
} from './visual-rules.types';
import { nodeHtmlFor } from './node-templates';

// ── Drawflow JSON shape ──

export interface DrawflowNode {
  id: number;
  name: string;
  data: Record<string, unknown>;
  class: string;
  html: string;
  inputs: Record<string, { connections: { node: string; input: string }[] }>;
  outputs: Record<string, { connections: { node: string; output: string }[] }>;
  pos_x: number;
  pos_y: number;
}

export interface DrawflowData {
  drawflow: { Home: { data: Record<string, DrawflowNode> } };
}

// ── Column layout constants ──

const COL_SENSOR  = 50;
const COL_COMPARE = 280;
const COL_LOGIC   = 510;
const COL_ACTION  = 740;
const COL_TIME    = 740;
const ROW_START   = 60;
const ROW_GAP     = 140;
const RULE_GAP    = 30;

// ── Deserialize: DeviceRuleRecord[] → Drawflow graph ──

export function deserializeRules(
  rules: DeviceRuleRecord[],
  fields: DeviceField[],
  controls: DeviceControl[],
): { graphData: DrawflowData; dataMap: Map<number, VisualNodeData> } {
  const dataMap = new Map<number, VisualNodeData>();
  const nodes: Record<string, DrawflowNode> = {};
  let nextId = 1;
  const sensorNodeIds = new Map<number, number>(); // field_idx → node id (reuse sensors)

  function makeNode(
    data: VisualNodeData, inputs: number, outputs: number,
    posX: number, posY: number,
  ): number {
    const id = nextId++;
    const inputObj: Record<string, { connections: { node: string; input: string }[] }> = {};
    for (let i = 1; i <= inputs; i++) inputObj[`input_${i}`] = { connections: [] };
    const outputObj: Record<string, { connections: { node: string; output: string }[] }> = {};
    for (let i = 1; i <= outputs; i++) outputObj[`output_${i}`] = { connections: [] };

    nodes[String(id)] = {
      id, name: data.type, data: { ...data } as unknown as Record<string, unknown>,
      class: data.type, html: nodeHtmlFor(data),
      inputs: inputObj, outputs: outputObj, pos_x: posX, pos_y: posY,
    };
    dataMap.set(id, data);
    return id;
  }

  function connect(srcId: number, tgtId: number, srcOutput = 'output_1', tgtInput = 'input_1'): void {
    const src = nodes[String(srcId)];
    const tgt = nodes[String(tgtId)];
    if (!src || !tgt) return;
    src.outputs[srcOutput]?.connections.push({ node: String(tgtId), output: tgtInput });
    tgt.inputs[tgtInput]?.connections.push({ node: String(srcId), input: srcOutput });
  }

  function fieldLabel(idx: number): string {
    const f = fields.find(f => f.field_idx === idx);
    return f ? (f.display_name || f.field_key) : `Field ${idx}`;
  }

  function controlLabel(idx: number): string {
    const c = controls.find(c => c.control_idx === idx);
    return c ? (c.display_name || c.control_key) : `Control ${idx}`;
  }

  function getOrCreateSensor(fieldIdx: number, posY: number): number {
    const existing = sensorNodeIds.get(fieldIdx);
    if (existing !== undefined) return existing;
    const data: SensorNodeData = { type: 'sensor', field_idx: fieldIdx, label: fieldLabel(fieldIdx) };
    const id = makeNode(data, 0, 1, COL_SENSOR, posY);
    sensorNodeIds.set(fieldIdx, id);
    return id;
  }

  let rowY = ROW_START;

  for (const rule of rules) {
    const ruleBaseY = rowY;

    // Primary sensor + compare
    const sensorId = getOrCreateSensor(rule.field_idx, ruleBaseY);
    const primaryCompare: CompareNodeData = {
      type: 'compare', operator: rule.operator, threshold: rule.threshold,
      is_primary: true, is_control: false,
    };
    const primaryCompareId = makeNode(primaryCompare, 1, 1, COL_COMPARE, ruleBaseY);
    connect(sensorId, primaryCompareId);

    // Extra conditions
    const extras = rule.extra_conditions ?? [];
    const extraCompareIds: number[] = [];
    let logicType: 'and' | 'or' = 'and';

    for (let i = 0; i < extras.length; i++) {
      const ec = extras[i];
      if (ec.field_idx === 0xFF || ec.field_idx === 255) continue;

      const ecY = ruleBaseY + (i + 1) * (ROW_GAP * 0.7);

      // Source node for extra condition
      let srcId: number;
      if (ec.is_control) {
        // For control-state conditions, create a sensor-like node with control label
        const data: SensorNodeData = {
          type: 'sensor', field_idx: ec.field_idx,
          label: controlLabel(ec.field_idx) + ' (state)',
        };
        srcId = makeNode(data, 0, 1, COL_SENSOR, ecY);
      } else {
        srcId = getOrCreateSensor(ec.field_idx, ecY);
      }

      const cmpData: CompareNodeData = {
        type: 'compare', operator: ec.operator, threshold: ec.threshold,
        is_primary: false, is_control: ec.is_control,
      };
      const cmpId = makeNode(cmpData, 1, 1, COL_COMPARE, ecY);
      connect(srcId, cmpId);
      extraCompareIds.push(cmpId);
      logicType = ec.logic || 'and';
    }

    // Action node
    const actionData: ActionNodeData = {
      type: 'action',
      control_idx: rule.control_idx,
      action_state: rule.action_state,
      priority: rule.priority ?? 128,
      cooldown_seconds: rule.cooldown_seconds ?? 300,
      enabled: rule.enabled ?? true,
      action_dur_x10s: rule.action_dur_x10s ?? 0,
      label: controlLabel(rule.control_idx),
    };
    const actionId = makeNode(actionData, 1, 0, COL_ACTION, ruleBaseY);

    // Wire up: if extras, use logic gate; otherwise direct compare→action
    if (extraCompareIds.length > 0) {
      const gateData: LogicGateNodeData = { type: 'logic_gate', logic: logicType };
      const numInputs = 1 + extraCompareIds.length; // primary + extras
      const gateId = makeNode(gateData, numInputs, 1, COL_LOGIC, ruleBaseY);
      connect(primaryCompareId, gateId, 'output_1', 'input_1');
      for (let i = 0; i < extraCompareIds.length; i++) {
        connect(extraCompareIds[i], gateId, 'output_1', `input_${i + 2}`);
      }
      connect(gateId, actionId);
    } else {
      connect(primaryCompareId, actionId);
    }

    // Time window node
    if (rule.time_start != null && rule.time_end != null && rule.time_start >= 0 && rule.time_end >= 0) {
      const twData: TimeWindowNodeData = {
        type: 'time_window', time_start: rule.time_start, time_end: rule.time_end,
      };
      // Place slightly below action
      const twId = makeNode(twData, 0, 1, COL_TIME, ruleBaseY + ROW_GAP * 0.8);
      // Connect to action — action needs an extra input
      const actionNode = nodes[String(actionId)];
      const inputKey = `input_2`;
      actionNode.inputs[inputKey] = { connections: [] };
      connect(twId, actionId, 'output_1', inputKey);
    }

    rowY += ROW_GAP + extras.length * (ROW_GAP * 0.7) + RULE_GAP;
  }

  return {
    graphData: { drawflow: { Home: { data: nodes } } },
    dataMap,
  };
}

// ── Serialize: Drawflow graph → DeviceRuleRecord[] ──

export function serializeRules(
  graph: DrawflowData,
  deviceEui: string,
  dataMap: Map<number, VisualNodeData>,
): { rules: Partial<DeviceRuleRecord>[]; errors: string[] } {
  const errors: string[] = [];
  const rules: Partial<DeviceRuleRecord>[] = [];
  const allNodes = graph.drawflow.Home.data;

  // Find all action nodes — each one is a rule
  const actionNodes = Object.values(allNodes).filter(n => n.name === 'action');

  if (actionNodes.length > 16) {
    errors.push(`Too many rules: ${actionNodes.length} (max 16)`);
  }

  for (let ri = 0; ri < actionNodes.length; ri++) {
    const actionNode = actionNodes[ri];
    const actionData = dataMap.get(actionNode.id) as ActionNodeData | undefined;
    if (!actionData) { errors.push(`Action node ${actionNode.id} has no data`); continue; }

    // Trace backwards from action
    const actionInputs = Object.values(actionNode.inputs);
    let primaryFieldIdx = 0;
    let primaryOperator = '>';
    let primaryThreshold = 0;
    let foundPrimary = false;
    const extraConditions: ExtraCondition[] = [];
    let timeStart: number | undefined;
    let timeEnd: number | undefined;

    for (const inp of actionInputs) {
      for (const conn of inp.connections) {
        const upstreamNode = allNodes[conn.node];
        if (!upstreamNode) continue;
        const upstreamData = dataMap.get(upstreamNode.id);
        if (!upstreamData) continue;

        if (upstreamData.type === 'time_window') {
          const tw = upstreamData as TimeWindowNodeData;
          timeStart = tw.time_start;
          timeEnd = tw.time_end;
        } else if (upstreamData.type === 'compare') {
          // Direct compare→action (no logic gate): this is the primary condition
          const cmp = upstreamData as CompareNodeData;
          const sensorId = findUpstreamSensor(upstreamNode, allNodes);
          const sensorData = sensorId ? dataMap.get(sensorId) as SensorNodeData | undefined : undefined;

          if (!foundPrimary) {
            foundPrimary = true;
            primaryFieldIdx = sensorData?.field_idx ?? 0;
            primaryOperator = cmp.operator;
            primaryThreshold = cmp.threshold;
          } else {
            extraConditions.push({
              field_idx: sensorData?.field_idx ?? 0,
              operator: cmp.operator,
              threshold: cmp.threshold,
              is_control: cmp.is_control,
              logic: 'and',
            });
          }
        } else if (upstreamData.type === 'logic_gate') {
          // Trace through logic gate to find all compare nodes
          const gate = upstreamData as LogicGateNodeData;
          const gateInputs = Object.values(upstreamNode.inputs);
          let firstFromGate = true;

          for (const gi of gateInputs) {
            for (const gc of gi.connections) {
              const cmpNode = allNodes[gc.node];
              if (!cmpNode) continue;
              const cmpData = dataMap.get(cmpNode.id) as CompareNodeData | undefined;
              if (!cmpData || cmpData.type !== 'compare') continue;

              const sensorId = findUpstreamSensor(cmpNode, allNodes);
              const sensorData = sensorId ? dataMap.get(sensorId) as SensorNodeData | undefined : undefined;

              if (firstFromGate && !foundPrimary) {
                foundPrimary = true;
                primaryFieldIdx = sensorData?.field_idx ?? 0;
                primaryOperator = cmpData.operator;
                primaryThreshold = cmpData.threshold;
                firstFromGate = false;
              } else {
                extraConditions.push({
                  field_idx: sensorData?.field_idx ?? 0,
                  operator: cmpData.operator,
                  threshold: cmpData.threshold,
                  is_control: cmpData.is_control,
                  logic: gate.logic,
                });
              }
            }
          }
        }
      }
    }

    if (!foundPrimary) {
      errors.push(`Rule ${ri}: no primary condition found (connect a Sensor→Compare→Action chain)`);
      continue;
    }

    if (extraConditions.length > 3) {
      errors.push(`Rule ${ri}: too many extra conditions (${extraConditions.length}, max 3)`);
    }

    rules.push({
      device_eui: deviceEui,
      rule_id: ri,
      field_idx: primaryFieldIdx,
      operator: primaryOperator,
      threshold: primaryThreshold,
      control_idx: actionData.control_idx,
      action_state: actionData.action_state,
      priority: actionData.priority,
      cooldown_seconds: actionData.cooldown_seconds,
      enabled: actionData.enabled,
      action_dur_x10s: actionData.action_dur_x10s,
      extra_conditions: extraConditions.slice(0, 3),
      time_start: timeStart,
      time_end: timeEnd,
    });
  }

  return { rules, errors };
}

// ── Helpers ──

function findUpstreamSensor(compareNode: DrawflowNode, allNodes: Record<string, DrawflowNode>): number | undefined {
  for (const inp of Object.values(compareNode.inputs)) {
    for (const conn of inp.connections) {
      const upNode = allNodes[conn.node];
      if (upNode?.name === 'sensor') return upNode.id;
    }
  }
  return undefined;
}
