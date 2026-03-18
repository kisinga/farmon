import { Injectable, inject } from '@angular/core';

import { DeviceService } from './device.service';
import { ProfileService } from './profile.service';
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
  DeviceIDFormatMeta,
  Device,
  DeviceTarget,
  DeviceControl,
  DeviceField,
  HistoryPoint,
  HistoryResponse,
  ProvisionResponse,
  CredentialsResponse,
  ExtraCondition,
  DeviceRuleRecord,
  CommandRecord,
  ProfileField,
  ProfileControl,
  ProfileCommand,
  DecodeRule,
  ProfileVisualization,
  ProfileAirConfig,
  DeviceProfile,
  ProfileSummary,
  GatewaySettings,
  GatewayStatusResponse,
  GatewaySettingsRecord,
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
  DEVICE_ID_FORMATS,
  getTransportMeta,
  getDeviceIDFormat,
} from './api.types';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private deviceService = inject(DeviceService);
  private profileService = inject(ProfileService);
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

  provisionDevice(device_eui: string, device_name?: string, profile_id?: string, transport?: import('./api.types').TransportType, target_id?: string) {
    return this.deviceService.provisionDevice(device_eui, device_name, profile_id, transport, target_id);
  }
  getDeviceTargets() { return this.deviceService.getDeviceTargets(); }
  deleteDevice(eui: string) { return this.deviceService.deleteDevice(eui); }
  getDeviceCredentials(eui: string) { return this.deviceService.getDeviceCredentials(eui); }
  updateDeviceOverrides(eui: string, overrides: unknown) { return this.deviceService.updateDeviceOverrides(eui, overrides); }
  pushConfig(eui: string) { return this.deviceService.pushConfig(eui); }

  // ─── Firmware Commands ───────────────────────────────────────────────────

  getFirmwareCommands() { return this.deviceService.getFirmwareCommands(); }
  getSensorCatalog() { return this.deviceService.getSensorCatalog(); }
  getBackendInfo() { return this.deviceService.getBackendInfo(); }
  patchBackendInfo(body: import('./api.types').BackendInfo) { return this.deviceService.patchBackendInfo(body); }

  // ─── Profiles ───────────────────────────────────────────

  getProfiles(templatesOnly = true, transport?: string) { return this.profileService.getProfiles(templatesOnly, transport); }
  getProfile(id: string) { return this.profileService.getProfile(id); }
  createProfile(body: { name: string; description?: string; profile_type: string; transport?: string; is_template?: boolean }) { return this.profileService.createProfile(body); }
  updateProfile(id: string, body: Partial<{ name: string; description: string; is_template: boolean }>) { return this.profileService.updateProfile(id, body); }
  deleteProfile(id: string) { return this.profileService.deleteProfile(id); }
  testDecode(profileId: string, fport: number, payloadHex: string) { return this.profileService.testDecode(profileId, fport, payloadHex); }

  // ─── Profile sub-component CRUD ─────────────────────────

  getProfileFields(profileId: string) { return this.profileService.getProfileFields(profileId); }
  createProfileField(data: Record<string, unknown>) { return this.profileService.createProfileField(data); }
  updateProfileField(id: string, data: Record<string, unknown>) { return this.profileService.updateProfileField(id, data); }
  deleteProfileField(id: string) { return this.profileService.deleteProfileField(id); }

  getProfileControls(profileId: string) { return this.profileService.getProfileControls(profileId); }
  createProfileControl(data: Record<string, unknown>) { return this.profileService.createProfileControl(data); }
  updateProfileControl(id: string, data: Record<string, unknown>) { return this.profileService.updateProfileControl(id, data); }
  deleteProfileControl(id: string) { return this.profileService.deleteProfileControl(id); }

  getProfileCommands(profileId: string) { return this.profileService.getProfileCommands(profileId); }
  createProfileCommand(data: Record<string, unknown>) { return this.profileService.createProfileCommand(data); }
  updateProfileCommand(id: string, data: Record<string, unknown>) { return this.profileService.updateProfileCommand(id, data); }
  deleteProfileCommand(id: string) { return this.profileService.deleteProfileCommand(id); }

  getDecodeRules(profileId: string) { return this.profileService.getDecodeRules(profileId); }
  createDecodeRule(data: Record<string, unknown>) { return this.profileService.createDecodeRule(data); }
  updateDecodeRule(id: string, data: Record<string, unknown>) { return this.profileService.updateDecodeRule(id, data); }
  deleteDecodeRule(id: string) { return this.profileService.deleteDecodeRule(id); }

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

  // ─── Workflows ──────────────────────────────────────────

  getWorkflows(deviceEui?: string) { return this.workflowService.getWorkflows(deviceEui); }
  createWorkflow(record: Partial<import('./api.types').WorkflowRecord>) { return this.workflowService.createWorkflow(record); }
  updateWorkflow(id: string, record: Partial<import('./api.types').WorkflowRecord>) { return this.workflowService.updateWorkflow(id, record); }
  deleteWorkflow(id: string) { return this.workflowService.deleteWorkflow(id); }
  testWorkflow(id: string, mockData: Record<string, unknown>) { return this.workflowService.testWorkflow(id, mockData); }
  getWorkflowLog(workflowId?: string, limit = 50) { return this.workflowService.getWorkflowLog(workflowId, limit); }
}
