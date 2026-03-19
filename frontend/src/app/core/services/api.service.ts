import { Injectable, inject } from '@angular/core';

import { DeviceService } from './device.service';
import { RulesService } from './rules.service';
import { SensorService } from './sensor.service';
import { GatewayApiService } from './gateway.service';
import { WorkflowService } from './workflow.service';

// Re-export all types so existing consumers that import from 'api.service.ts' keep working.
export type {
  BackendInfo,
  FirmwareCommand,
  TransportType,
  TransportMeta,
  Device,
  DeviceCommand,
  DeviceControl,
  DeviceField,
  DeviceVisualization,
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
} from './api.types';

export {
  TRANSPORT_META,
  getTransportMeta,
} from './api.types';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private deviceService = inject(DeviceService);
  private rulesService = inject(RulesService);
  private sensorService = inject(SensorService);
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

  setControl(eui: string, control: string, state: string, duration?: number) { return this.deviceService.setControl(eui, control, state, duration); }
  sendCommand(eui: string, command: string, value?: number) { return this.deviceService.sendCommand(eui, command, value); }
  getCommandHistory(eui: string, limit = 50) { return this.deviceService.getCommandHistory(eui, limit); }
  getStateChanges(eui: string, limit = 100) { return this.deviceService.getStateChanges(eui, limit); }
  getDeviceWorkflowEvents(eui: string, limit = 50) { return this.deviceService.getDeviceWorkflowEvents(eui, limit); }

  // ─── Provisioning ───────────────────────────────────────

  provisionDevice(device_eui: string, device_name?: string, transport?: import('./api.types').TransportType, spec?: import('./api.types').DeviceSpec) {
    return this.deviceService.provisionDevice(device_eui, device_name, transport, spec);
  }
  deleteDevice(eui: string) { return this.deviceService.deleteDevice(eui); }
  getDeviceCredentials(eui: string) { return this.deviceService.getDeviceCredentials(eui); }
  pushConfig(eui: string) { return this.deviceService.pushConfig(eui); }

  // ─── Device Spec ────────────────────────────────────────

  getDeviceSpec(eui: string) { return this.deviceService.getDeviceSpec(eui); }
  applyDeviceSpec(eui: string, spec: import('./api.types').DeviceSpec) { return this.deviceService.applyDeviceSpec(eui, spec); }
  testDecode(spec: import('./api.types').DeviceSpec, fport: number, payloadHex: string) { return this.deviceService.testDecode(spec, fport, payloadHex); }

  // ─── Firmware Commands ───────────────────────────────────────────────────

  getFirmwareCommands() { return this.deviceService.getFirmwareCommands(); }
  getSensorCatalog() { return this.deviceService.getSensorCatalog(); }
  getBackendInfo() { return this.deviceService.getBackendInfo(); }
  patchBackendInfo(body: import('./api.types').BackendInfo) { return this.deviceService.patchBackendInfo(body); }

  // ─── Device Rules ───────────────────────────────────────

  getDeviceRules(eui: string) { return this.rulesService.getDeviceRules(eui); }
  createDeviceRule(record: Partial<import('./api.types').DeviceRuleRecord>) { return this.rulesService.createDeviceRule(record); }
  updateDeviceRule(id: string, record: Partial<import('./api.types').DeviceRuleRecord>) { return this.rulesService.updateDeviceRule(id, record); }
  deleteDeviceRule(id: string) { return this.rulesService.deleteDeviceRule(id); }
  pushDeviceRules(eui: string) { return this.rulesService.pushDeviceRules(eui); }

  // ─── Sensor Slot Config ─────────────────────────────────

  pushSensorSlot(eui: string, body: {
    slot: number;
    type: number;
    pin_index: number;
    field_index: number;
    flags: number;
    calib_offset?: number;
    calib_span?: number;
    param1_raw?: number;
    param2_raw?: number;
  }) { return this.sensorService.pushSensorSlot(eui, body); }

  createDeviceField(data: Partial<import('./api.types').DeviceField>) { return this.sensorService.createDeviceField(data); }
  updateDeviceField(id: string, data: Partial<import('./api.types').DeviceField>) { return this.sensorService.updateDeviceField(id, data); }

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
