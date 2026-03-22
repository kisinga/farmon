import { Injectable, inject } from '@angular/core';

import { DeviceService } from './device.service';
import { RulesService } from './rules.service';
import { IOSlotService } from './io-slot.service';
import { GatewayApiService } from './gateway.service';
import { WorkflowService } from './workflow.service';

// Re-export all types so existing consumers that import from 'api.service.ts' keep working.
export type {
  BackendInfo,
  BoardDefinition,
  BoardPinDef,
  FirmwareCommand,
  TransportType,
  TransportMeta,
  HardwareModelId,
  HardwareModelInfo,
  Device,
  DeviceCommand,
  DeviceControl,
  DeviceDecodeRule,
  DeviceField,
  DeviceVariable,
  DeviceVisualization,
  VariableVizConfig,
  DeviceSpec,
  SpecField,
  SpecControl,
  SpecCommand,
  SpecDecodeRule,
  SpecVisualization,
  SpecAirConfig,
  HistoryPoint,
  HistoryResponse,
  ProvisionResponse,
  CredentialsResponse,
  ExtraCondition,
  DeviceRuleRecord,
  CommandRecord,
  GatewaySettings,
  GatewayStatusResponse,
  GatewaySettingsRecord,
  WifiSettings,
  WifiSettingsRecord,
  PipelineDebug,
  RawLorawanFrame,
  LorawanStats,
  WorkflowTrigger,
  WorkflowAction,
  WorkflowRecord,
  WorkflowLogRecord,
  TelemetryRecord,
  StateChangeRecord,
  PinInfo,
  PinCapabilitiesResponse,
  ActuatorTypeId,
  IOCatalog,
  OutputInterfaceInfo,
  ValidationError,
} from './api.types';

export {
  TRANSPORT_META,
  getTransportMeta,
  HARDWARE_MODELS,
  ACTUATOR_TYPES,
  isAnalogActuator,
  isDualPinActuator,
  isBusActuator,
  hasPulseParam,
} from './api.types';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private deviceService = inject(DeviceService);
  private rulesService = inject(RulesService);
  private ioSlotService = inject(IOSlotService);
  private gatewayService = inject(GatewayApiService);
  private workflowService = inject(WorkflowService);

  // ─── Devices ────────────────────────────────────────────

  getDevices() { return this.deviceService.getDevices(); }
  getDeviceConfig(eui: string) { return this.deviceService.getDeviceConfig(eui); }
  getDeviceControls(eui: string) { return this.deviceService.getDeviceControls(eui); }
  getDeviceFields(eui: string) { return this.deviceService.getDeviceFields(eui); }
  getHistory(eui: string, field: string, fromDate?: string, toDate?: string, limit = 500) { return this.deviceService.getHistory(eui, field, fromDate, toDate, limit); }
  getLatestTelemetry(eui: string) { return this.deviceService.getLatestTelemetry(eui); }

  // ─── Controls & Commands ────────────────────────────────

  setControl(eui: string, control: string, state: string, duration?: number, value?: number) { return this.deviceService.setControl(eui, control, state, duration, value); }
  getPinCapabilities(eui: string) { return this.deviceService.getPinCapabilities(eui); }
  getBoardInfo(model: string) { return this.deviceService.getBoardInfo(model); }
  probeField(eui: string, fieldKey: string) { return this.deviceService.probeField(eui, fieldKey); }
  compileExpression(eui: string, expression: string) { return this.deviceService.compileExpression(eui, expression); }
  sendCommand(eui: string, command: string, value?: number) { return this.deviceService.sendCommand(eui, command, value); }
  getCommandHistory(eui: string, limit = 50) { return this.deviceService.getCommandHistory(eui, limit); }
  getStateChanges(eui: string, limit = 100) { return this.deviceService.getStateChanges(eui, limit); }
  getDeviceWorkflowEvents(eui: string, limit = 50) { return this.deviceService.getDeviceWorkflowEvents(eui, limit); }

  // ─── Provisioning ───────────────────────────────────────

  provisionDevice(device_eui: string, device_name?: string, transport?: import('./api.types').TransportType, spec?: import('./api.types').DeviceSpec, hardware_model?: string, device_category?: import('./api.types').DeviceCategory) {
    return this.deviceService.provisionDevice(device_eui, device_name, transport, spec, hardware_model, device_category);
  }
  deleteDevice(eui: string) { return this.deviceService.deleteDevice(eui); }
  getDeviceCredentials(eui: string) { return this.deviceService.getDeviceCredentials(eui); }
  pushConfig(eui: string) { return this.deviceService.pushConfig(eui); }

  // ─── Firmware Builder ───────────────────────────────────
  getFirmwareStatus(eui: string) { return this.deviceService.getFirmwareStatus(eui); }
  saveFirmwareCredentials(eui: string, data: { wifi_ssid?: string; wifi_password?: string; backend_url?: string }) {
    return this.deviceService.saveFirmwareCredentials(eui, data);
  }
  buildFirmware(eui: string) { return this.deviceService.buildFirmware(eui); }
  getFirmwareDownloadUrl(eui: string): string { return this.deviceService.getFirmwareDownloadUrl(eui); }

  // ─── Device Spec ────────────────────────────────────────

  getDeviceSpec(eui: string) { return this.deviceService.getDeviceSpec(eui); }
  applyDeviceSpec(eui: string, spec: import('./api.types').DeviceSpec) { return this.deviceService.applyDeviceSpec(eui, spec); }
  testDecode(spec: import('./api.types').DeviceSpec, fport: number, payloadHex: string) { return this.deviceService.testDecode(spec, fport, payloadHex); }

  // ─── Decode Rules ────────────────────────────────────────

  getDeviceDecodeRules(eui: string) { return this.deviceService.getDeviceDecodeRules(eui); }
  createDeviceDecodeRule(data: Partial<import('./api.types').DeviceDecodeRule>) { return this.deviceService.createDeviceDecodeRule(data); }
  updateDeviceDecodeRule(id: string, data: Partial<import('./api.types').DeviceDecodeRule>) { return this.deviceService.updateDeviceDecodeRule(id, data); }
  deleteDeviceDecodeRule(id: string) { return this.deviceService.deleteDeviceDecodeRule(id); }

  // ─── Visualizations ─────────────────────────────────────

  getDeviceVisualizations(eui: string) { return this.deviceService.getDeviceVisualizations(eui); }

  // ─── Firmware Commands ───────────────────────────────────────────────────

  getFirmwareCommands() { return this.deviceService.getFirmwareCommands(); }
  getIOCatalog() { return this.deviceService.getIOCatalog(); }
  getSensorCatalog() { return this.deviceService.getIOCatalog(); }
  getDriverCatalog(target?: string) { return this.deviceService.getDriverCatalog(target); }
  getBackendInfo() { return this.deviceService.getBackendInfo(); }
  patchBackendInfo(body: import('./api.types').BackendInfo) { return this.deviceService.patchBackendInfo(body); }

  // ─── Device Rules ───────────────────────────────────────

  getDeviceRules(eui: string) { return this.rulesService.getDeviceRules(eui); }
  createDeviceRule(record: Partial<import('./api.types').DeviceRuleRecord>) { return this.rulesService.createDeviceRule(record); }
  updateDeviceRule(id: string, record: Partial<import('./api.types').DeviceRuleRecord>) { return this.rulesService.updateDeviceRule(id, record); }
  deleteDeviceRule(id: string) { return this.rulesService.deleteDeviceRule(id); }
  pushDeviceRules(eui: string) { return this.rulesService.pushDeviceRules(eui); }

  // ─── IO Slot Config (sensors + controls → fPort 35) ─────

  pushSensorSlot(eui: string, body: import('./io-slot.service').SensorSlotPayload) { return this.ioSlotService.pushSensorSlot(eui, body); }
  pushControlSlot(eui: string, body: import('./io-slot.service').ControlSlotPayload) { return this.ioSlotService.pushControlSlot(eui, body); }

  createDeviceField(data: Partial<import('./api.types').DeviceField>) { return this.ioSlotService.createDeviceField(data); }
  updateDeviceField(id: string, data: Partial<import('./api.types').DeviceField>) { return this.ioSlotService.updateDeviceField(id, data); }
  deleteDeviceField(id: string) { return this.deviceService.deleteDeviceField(id); }

  createDeviceControl(data: Partial<import('./api.types').DeviceControl>) { return this.deviceService.createDeviceControl(data); }
  updateDeviceControl(id: string, data: Partial<import('./api.types').DeviceControl>) { return this.deviceService.updateDeviceControl(id, data); }
  deleteDeviceControl(id: string) { return this.deviceService.deleteDeviceControl(id); }

  // ─── Gateway & Pipeline ─────────────────────────────────

  getGatewayStatus() { return this.gatewayService.getGatewayStatus(); }
  getPipelineDebug() { return this.gatewayService.getPipelineDebug(); }
  getLorawanStats() { return this.gatewayService.getLorawanStats(); }
  getLorawanFrames(limit = 200) { return this.gatewayService.getLorawanFrames(limit); }
  getDeviceFrames(eui: string, limit = 50) { return this.gatewayService.getDeviceFrames(eui, limit); }
  getGatewaySettings() { return this.gatewayService.getGatewaySettings(); }
  patchGatewaySettings(settings: Partial<import('./api.types').GatewaySettings>) { return this.gatewayService.patchGatewaySettings(settings); }
  getWifiSettings() { return this.gatewayService.getWifiSettings(); }
  patchWifiSettings(settings: Partial<import('./api.types').WifiSettings>) { return this.gatewayService.patchWifiSettings(settings); }

  // ─── Workflows ──────────────────────────────────────────

  getWorkflows(deviceEui?: string) { return this.workflowService.getWorkflows(deviceEui); }
  createWorkflow(record: Partial<import('./api.types').WorkflowRecord>) { return this.workflowService.createWorkflow(record); }
  updateWorkflow(id: string, record: Partial<import('./api.types').WorkflowRecord>) { return this.workflowService.updateWorkflow(id, record); }
  deleteWorkflow(id: string) { return this.workflowService.deleteWorkflow(id); }
  testWorkflow(id: string, mockData: Record<string, unknown>) { return this.workflowService.testWorkflow(id, mockData); }
  getWorkflowLog(workflowId?: string, limit = 50) { return this.workflowService.getWorkflowLog(workflowId, limit); }
}
