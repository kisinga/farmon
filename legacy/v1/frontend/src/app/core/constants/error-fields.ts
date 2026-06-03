/**
 * Error object keys and labels per DATA_CONTRACT (§5). Categories for diagnostics UI.
 */
export const ERROR_OBJECT_KEYS = [
  'ec',
  'na', 'jf', 'sf',
  'sr', 'dr', 'dp',
  'cs', 'wf', 'tm',
  'mm', 'qf', 'ts',
  'rf', 'cv', 'pf',
] as const;

export const ERROR_FIELD_LABELS: Record<string, string> = {
  ec: 'Errors',
  na: 'No ACK',
  jf: 'Join fail',
  sf: 'Send fail',
  sr: 'Sensor read',
  dr: 'Driver',
  dp: 'Display',
  cs: 'OTA CRC',
  wf: 'OTA write',
  tm: 'OTA timeout',
  mm: 'Memory',
  qf: 'Queue full',
  ts: 'Task',
  rf: 'Rule',
  cv: 'Config',
  pf: 'Persistence',
};

export const ERROR_CATEGORIES: Record<string, string[]> = {
  Communication: ['na', 'jf', 'sf'],
  Hardware: ['sr', 'dr', 'dp'],
  OTA: ['cs', 'wf', 'tm'],
  System: ['mm', 'qf', 'ts'],
  Logic: ['rf', 'cv', 'pf'],
};
