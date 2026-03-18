export type NodeType = 'sensor' | 'compare' | 'logic_gate' | 'action' | 'time_window';

export interface SensorNodeData {
  type: 'sensor';
  field_idx: number;
  label: string;
}

export interface CompareNodeData {
  type: 'compare';
  operator: string;    // '<' | '>' | '<=' | '>=' | '==' | '!='
  threshold: number;
  is_primary: boolean; // primary allows float; extra is int 0-255
  is_control: boolean; // extra condition checking control state
}

export interface LogicGateNodeData {
  type: 'logic_gate';
  logic: 'and' | 'or';
}

export interface ActionNodeData {
  type: 'action';
  control_idx: number;
  action_state: number;
  priority: number;
  cooldown_seconds: number;
  enabled: boolean;
  action_dur_x10s: number;
  label: string;
}

export interface TimeWindowNodeData {
  type: 'time_window';
  time_start: number;  // hour 0-23
  time_end: number;
}

export type VisualNodeData =
  | SensorNodeData
  | CompareNodeData
  | LogicGateNodeData
  | ActionNodeData
  | TimeWindowNodeData;

export const OPERATORS = ['<', '>', '<=', '>=', '==', '!='] as const;
