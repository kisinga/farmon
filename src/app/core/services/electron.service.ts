import { Injectable } from '@angular/core';
import type {
  ElectronAPI,
  BoardListEntry,
  BoardLoadResult,
  GenerateResult,
  GenerationType,
  GenerationMeta,
  GenerationSnapshot,
  ValidationResult,
  ToolchainInfo,
  ProcessResult,
  ProcessHandle,
  ProcessOutputEvent,
  ProcessDoneEvent,
  SerialDevice,
  SerialHandle,
  SerialOutputEvent,
  SerialDoneEvent,
  HealthReport,
  SeedChange,
  SiteListEntry,
  SiteFullPayload,
  SiteSavePayload,
  Controller,
  TemplateListEntry,
  DriftReport,
  LegacyScanResult,
  LegacySiteImport,
  DeploymentPlan,
  DeploymentResult,
} from '../models/electron-api';
import type { NetworkConfig, BoardDef, Route, SiteTopology, SystemTopology } from '@far-mon/core';

@Injectable({ providedIn: 'root' })
export class ElectronService {
  private get api(): ElectronAPI | undefined {
    return (window as Window).electronAPI;
  }

  get isElectron(): boolean {
    return !!this.api;
  }

  // --- Sites ---
  siteList(): Promise<SiteListEntry[]> {
    return this.api?.siteList() ?? Promise.resolve([]);
  }
  siteLoad(id: string): Promise<SiteFullPayload> {
    return this.invoke(api => api.siteLoad(id));
  }
  async siteSave(payload: SiteSavePayload): Promise<void> {
    await this.invoke(api => api.siteSave(payload));
  }
  async siteCreate(id: string, friendlyName: string): Promise<void> {
    await this.invoke(api => api.siteCreate(id, friendlyName));
  }
  async siteDelete(id: string): Promise<void> {
    await this.invoke(api => api.siteDelete(id));
  }
  async siteDuplicate(sourceId: string, newId: string, newFriendlyName: string): Promise<string> {
    const result = await this.invoke(api => api.siteDuplicate(sourceId, newId, newFriendlyName));
    return result.id;
  }
  async siteRename(id: string, friendlyName: string): Promise<void> {
    await this.invoke(api => api.siteRename(id, friendlyName));
  }
  siteExport(siteId: string): Promise<{ ok: boolean; path?: string }> {
    return this.invoke(api => api.siteExport(siteId));
  }
  siteImport(): Promise<{ ok: boolean; siteId?: string }> {
    return this.invoke(api => api.siteImport());
  }

  // --- Systems ---
  systemAddFromTemplate(siteId: string, templateName: string): Promise<Controller> {
    return this.invoke(api => api.systemAddFromTemplate(siteId, templateName));
  }
  systemCreateBlank(siteId: string, friendlyName: string, board: string): Promise<Controller> {
    return this.invoke(api => api.systemCreateBlank(siteId, friendlyName, board));
  }
  async systemDelete(siteId: string, systemId: string): Promise<void> {
    await this.invoke(api => api.systemDelete(siteId, systemId));
  }

  // --- Templates ---
  templateList(): Promise<TemplateListEntry[]> {
    return this.api?.templateList() ?? Promise.resolve([]);
  }
  templateLoad(name: string): Promise<Record<string, unknown>> {
    return this.invoke(api => api.templateLoad(name));
  }

  // --- Boards ---
  boardList(): Promise<BoardListEntry[]> {
    return this.api?.boardList() ?? Promise.resolve([]);
  }
  boardLoad(model: string): Promise<BoardLoadResult> {
    return this.invoke(api => api.boardLoad(model));
  }
  importBoard(dirPath: string): Promise<string> {
    return this.invoke(api => api.boardImport(dirPath));
  }

  // --- Codegen ---
  deriveRoutes(topology: SiteTopology | SystemTopology): Promise<Array<{ key: string; name: string }>> {
    if (!this.api) return Promise.resolve([]);
    return this.api.codegenDeriveRoutes(topology);
  }
  validate(topology: SiteTopology | SystemTopology, board: BoardDef, siteId?: string): Promise<ValidationResult> {
    if (!this.api) return Promise.resolve({ errors: ['Not in Electron'], warnings: [], ok: false, diagnostics: [] });
    return this.api.codegenValidate(topology, board, siteId);
  }
  generate(siteId: string, systemId: string, topology: SiteTopology | SystemTopology, board: BoardDef): Promise<GenerateResult> {
    return this.invoke(api => api.codegenGenerate(siteId, systemId, topology, board));
  }
  generateSiteHA(siteId: string): Promise<import('../models/electron-api').GenerateHAResult> {
    return this.invoke(api => api.codegenGenerateHA(siteId));
  }
  generateSiteDocs(siteId: string, compositeSvg: string, perSystemSvgs: Record<string, string>, topology: SiteTopology, routes: Route[]): Promise<{ html: string; outputPath: string }> {
    return this.invoke(api => api.codegenGenerateSiteDocs(siteId, compositeSvg, perSystemSvgs, topology, routes));
  }
  writeScadaArtifacts(siteId: string, artifacts: Array<{ name: string; svg: string; meta: unknown }>): Promise<{ outputDir: string; files: Array<{ path: string; bytes: number }> }> {
    return this.invoke(api => api.codegenWriteScadaArtifacts(siteId, artifacts));
  }
  generateSelfTest(boardModel: string, secrets: Record<string, string>, network?: NetworkConfig): Promise<{ outputDir: string; deviceDir: string; files: Array<{ path: string; description: string; lines: number }> }> {
    return this.invoke(api => api.codegenGenerateSelfTest(boardModel, secrets, network));
  }

  // --- Toolchain ---
  toolchainStatus(): Promise<ToolchainInfo> {
    if (!this.api) return Promise.resolve({ esphomePath: null, pythonPath: null, version: null });
    return this.api.toolchainStatus();
  }
  toolchainRefresh(): Promise<ToolchainInfo> {
    return this.invoke(api => api.toolchainRefresh());
  }

  // --- ESPHome operations ---
  esphomeCompile(configName: string): Promise<ProcessResult> {
    return this.invoke(api => api.esphomeCompile(configName));
  }
  esphomeFlash(configName: string, device?: string): Promise<ProcessResult> {
    return this.invoke(api => api.esphomeFlash(configName, device));
  }
  esphomeLogs(configName: string, device?: string): Promise<ProcessResult> {
    return this.invoke(api => api.esphomeLogs(configName, device));
  }
  esphomeCancel(processId: string): Promise<{ cancelled: boolean }> {
    return this.invoke(api => api.esphomeCancel(processId));
  }

  // --- Process events (unified for all backends) ---
  onProcessStarted(callback: (handle: ProcessHandle) => void): () => void {
    return this.api?.onProcessStarted(callback) ?? (() => {});
  }
  onProcessOutput(callback: (data: ProcessOutputEvent) => void): () => void {
    return this.api?.onProcessOutput(callback) ?? (() => {});
  }
  onProcessDone(callback: (data: ProcessDoneEvent) => void): () => void {
    return this.api?.onProcessDone(callback) ?? (() => {});
  }

  // --- Serial monitor ---
  serialMonitor(port: string, baudRate: number): Promise<SerialHandle> {
    return this.invoke(api => api.serialMonitor(port, baudRate));
  }
  serialCancel(processId: string): Promise<{ cancelled: boolean }> {
    return this.invoke(api => api.serialCancel(processId));
  }
  onSerialOutput(callback: (data: SerialOutputEvent) => void): () => void {
    return this.api?.onSerialOutput(callback) ?? (() => {});
  }
  onSerialDone(callback: (data: SerialDoneEvent) => void): () => void {
    return this.api?.onSerialDone(callback) ?? (() => {});
  }

  // --- Discovery ---
  deviceListSerial(): Promise<SerialDevice[]> {
    if (!this.api) return Promise.resolve([]);
    return this.api.deviceListSerial();
  }

  // --- File Dialogs ---
  pickFile(options: { title?: string; filters?: Array<{ name: string; extensions: string[] }> } = {}): Promise<string | null> {
    if (!this.api) return Promise.resolve(null);
    return this.api.pickFile(options);
  }
  pickDirectory(options: { title?: string } = {}): Promise<string | null> {
    if (!this.api) return Promise.resolve(null);
    return this.api.pickDirectory(options);
  }
  saveFile(options: { title?: string; defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> } = {}): Promise<string | null> {
    if (!this.api) return Promise.resolve(null);
    return this.api.saveFile(options);
  }

  // --- Shell ---
  shellOpenPath(fullPath: string): Promise<string> {
    if (!this.api) return Promise.resolve('');
    return this.api.shellOpenPath(fullPath);
  }
  shellShowInFolder(fullPath: string): Promise<{ ok: boolean }> {
    if (!this.api) return Promise.resolve({ ok: false });
    return this.api.shellShowInFolder(fullPath);
  }

  // --- Health ---
  healthCheck(): Promise<HealthReport> {
    if (!this.api) return Promise.resolve({ ok: false, checks: [] });
    return this.api.healthCheck();
  }
  healthFix(): Promise<{ success: boolean; output: string }> {
    return this.invoke(api => api.healthFix());
  }

  // --- Store ---
  outputDir(): Promise<string> {
    return this.invoke(api => api.outputDir());
  }
  seedChanges(): Promise<SeedChange[]> {
    return this.api?.seedChanges() ?? Promise.resolve([]);
  }
  applySeed(id?: string): Promise<{ ok: boolean }> {
    return this.invoke(api => api.applySeed(id));
  }
  dismissSeed(id: string): Promise<{ ok: boolean }> {
    return this.invoke(api => api.dismissSeed(id));
  }

  // --- Legacy import ---
  legacyHasData(): Promise<boolean> {
    if (!this.api) return Promise.resolve(false);
    return this.api.legacyHasData();
  }
  legacyScan(): Promise<LegacyScanResult> {
    return this.invoke(api => api.legacyScan());
  }
  legacyImport(sites: LegacySiteImport[]): Promise<{ imported: number }> {
    return this.invoke(api => api.legacyImport(sites));
  }

  // --- HA config files ---
  siteHaList(siteId: string): Promise<string[]> {
    return this.api?.siteHaList(siteId) ?? Promise.resolve([]);
  }
  siteHaLoad(siteId: string, filename: string): Promise<string> {
    return this.invoke(api => api.siteHaLoad(siteId, filename));
  }
  async siteHaSave(siteId: string, filename: string, content: string): Promise<void> {
    await this.invoke(api => api.siteHaSave(siteId, filename, content));
  }

  // --- Generation history ---
  generationList(siteId: string, systemId: string, genType?: GenerationType): Promise<GenerationMeta[]> {
    return this.api?.generationList(siteId, systemId, genType) ?? Promise.resolve([]);
  }
  generationLoad(id: number): Promise<GenerationSnapshot | null> {
    return this.invoke(api => api.generationLoad(id));
  }
  generationFind(version: string): Promise<GenerationSnapshot | null> {
    return this.invoke(api => api.generationFind(version));
  }
  generationLatest(siteId: string, systemId: string, genType?: GenerationType): Promise<GenerationMeta | null> {
    return this.api?.generationLatest(siteId, systemId, genType) ?? Promise.resolve(null);
  }

  // --- System secrets ---
  secretsGet(siteId: string, systemId: string): Promise<Record<string, string>> {
    return this.api?.secretsGet(siteId, systemId) ?? Promise.resolve({});
  }
  async secretsSet(siteId: string, systemId: string, secrets: Record<string, string>): Promise<void> {
    await this.invoke(api => api.secretsSet(siteId, systemId, secrets));
  }

  // --- System settings ---
  settingsGet(siteId: string, systemId: string, key: string): Promise<string | null> {
    return this.api?.settingsGet(siteId, systemId, key) ?? Promise.resolve(null);
  }
  async settingsSet(siteId: string, systemId: string, key: string, value: string): Promise<void> {
    await this.invoke(api => api.settingsSet(siteId, systemId, key, value));
  }
  settingsGetAll(siteId: string, systemId: string): Promise<Record<string, string>> {
    return this.api?.settingsGetAll(siteId, systemId) ?? Promise.resolve({});
  }

  // --- Fleet telemetry & drift detection ---
  driftCheck(siteId: string): Promise<DriftReport[]> {
    return this.invoke(api => api.driftCheck(siteId));
  }
  driftHaCheck(): Promise<{ ok: boolean; version?: string; error?: string }> {
    return this.api?.driftHaCheck() ?? Promise.resolve({ ok: false, error: 'Not in Electron' });
  }

  // --- App settings ---
  appSettingGet(key: string): Promise<string | null> {
    return this.api?.appSettingGet(key) ?? Promise.resolve(null);
  }
  async appSettingSet(key: string, value: string): Promise<void> {
    await this.invoke(api => api.appSettingSet(key, value));
  }

  // --- Topology event log ---
  eventsList(siteId: string, limit?: number): Promise<Array<{ id: number; siteId: string; timestamp: string; actor: string | null; eventType: string; payload: string }>> {
    return this.api?.eventsList(siteId, limit) ?? Promise.resolve([]);
  }
  eventsCount(siteId: string): Promise<number> {
    return this.api?.eventsCount(siteId) ?? Promise.resolve(0);
  }
  async eventsReconstruct(siteId: string, eventId: number): Promise<SiteTopology | null> {
    return this.invoke(api => api.eventsReconstruct(siteId, eventId));
  }

  // --- Coordinated deployment ---
  deploymentPlan(siteId: string, targetControllers?: string[]): Promise<DeploymentPlan> {
    return this.invoke(api => api.deploymentPlan(siteId, targetControllers));
  }
  deploymentExecute(plan: DeploymentPlan): Promise<DeploymentResult[]> {
    return this.invoke(api => api.deploymentExecute(plan));
  }
  deploymentRollback(siteId: string, controllerId: string): Promise<DeploymentResult[]> {
    return this.invoke(api => api.deploymentRollback(siteId, controllerId));
  }

  private invoke<T>(fn: (api: ElectronAPI) => Promise<T>): Promise<T> {
    if (!this.api) return Promise.reject(new Error('Not running in Electron'));
    return fn(this.api);
  }
}
