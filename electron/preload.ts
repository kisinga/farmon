import { contextBridge, ipcRenderer } from "electron";
import type {
  SiteSavePayload,
  SiteTopology,
  SystemTopology,
  BoardDef,
  NetworkConfig,
  Route,
} from "@far-mon/core";
import type {
  DeploymentPlan,
  DeploymentResult,
} from "./deployment-coordinator.js";
import type { LegacyImportResult } from "./store.js";

contextBridge.exposeInMainWorld("electronAPI", {
  // --- Sites ---
  siteList: () => ipcRenderer.invoke("site:list"),
  siteLoad: (id: string) => ipcRenderer.invoke("site:load", id),
  siteSave: (payload: SiteSavePayload) => ipcRenderer.invoke("site:save", payload),
  siteCreate: (id: string, friendlyName: string) =>
    ipcRenderer.invoke("site:create", id, friendlyName),
  siteDelete: (id: string) => ipcRenderer.invoke("site:delete", id),
  siteDuplicate: (sourceId: string, newId: string, newFriendlyName: string) =>
    ipcRenderer.invoke("site:duplicate", sourceId, newId, newFriendlyName),
  siteRename: (id: string, friendlyName: string) =>
    ipcRenderer.invoke("site:rename", id, friendlyName),
  siteExport: (siteId: string) =>
    ipcRenderer.invoke("site:export", siteId),
  siteImport: () =>
    ipcRenderer.invoke("site:import"),

  // --- Systems ---
  systemList: (siteId: string) => ipcRenderer.invoke("system:list", siteId),
  systemAddFromTemplate: (siteId: string, templateName: string, friendlyName?: string) =>
    ipcRenderer.invoke("system:add-from-template", siteId, templateName, friendlyName),
  systemCreateBlank: (siteId: string, friendlyName: string, board: string) =>
    ipcRenderer.invoke("system:create-blank", siteId, friendlyName, board),
  systemDelete: (siteId: string, systemId: string) =>
    ipcRenderer.invoke("system:delete", siteId, systemId),

  // --- Templates ---
  templateList: () => ipcRenderer.invoke("template:list"),
  templateLoad: (name: string) => ipcRenderer.invoke("template:load", name),

  // --- Board definitions ---
  boardList: () => ipcRenderer.invoke("board:list"),
  boardLoad: (model: string) => ipcRenderer.invoke("board:load", model),
  boardImport: (dirPath: string) => ipcRenderer.invoke("board:import", dirPath),

  // --- Codegen ---
  codegenDeriveRoutes: (topology: SiteTopology | SystemTopology) =>
    ipcRenderer.invoke("codegen:derive-routes", topology),
  codegenValidate: (topology: SiteTopology | SystemTopology, board: BoardDef, siteId?: string) =>
    ipcRenderer.invoke("codegen:validate", topology, board, siteId),
  codegenGenerate: (siteId: string, systemId: string, topology: SiteTopology | SystemTopology, board: BoardDef) =>
    ipcRenderer.invoke("codegen:generate", siteId, systemId, topology, board),
  codegenGenerateHA: (siteId: string) =>
    ipcRenderer.invoke("codegen:generate-ha", siteId),
  codegenGenerateSelfTest: (boardModel: string, secrets: Record<string, string>, network?: NetworkConfig) =>
    ipcRenderer.invoke("codegen:generate-selftest", boardModel, secrets, network),
  codegenGenerateSiteDocs: (siteId: string, compositeSvg: string, perSystemSvgs: Record<string, string>, topology: SiteTopology, routes: Route[]) =>
    ipcRenderer.invoke("codegen:generate-site-docs", siteId, compositeSvg, perSystemSvgs, topology, routes),
  codegenWriteScadaArtifacts: (siteId: string, artifacts: Array<{ name: string; svg: string; meta: unknown }>) =>
    ipcRenderer.invoke("codegen:write-scada-artifacts", siteId, artifacts),

  // --- Toolchain ---
  toolchainStatus: () => ipcRenderer.invoke("toolchain:status"),
  toolchainRefresh: () => ipcRenderer.invoke("toolchain:refresh"),

  // --- ESPHome operations ---
  esphomeCompile: (configName: string) =>
    ipcRenderer.invoke("esphome:compile", configName),
  esphomeFlash: (configName: string, device?: string) =>
    ipcRenderer.invoke("esphome:flash", configName, device),
  esphomeLogs: (configName: string, device?: string) =>
    ipcRenderer.invoke("esphome:logs", configName, device),
  esphomeCancel: (processId: string) =>
    ipcRenderer.invoke("esphome:cancel", processId),

  // --- Process events (main → renderer) ---
  onProcessStarted: (
    callback: (handle: {
      id: string;
      backend: string;
      operation: string;
      configName: string;
      pid: number | undefined;
    }) => void
  ) => {
    const listener = (_event: unknown, handle: Parameters<typeof callback>[0]) =>
      callback(handle);
    ipcRenderer.on("process:started", listener);
    return () => ipcRenderer.removeListener("process:started", listener);
  },
  onProcessOutput: (
    callback: (data: {
      id: string;
      backend: string;
      operation: string;
      stream: string;
      text: string;
    }) => void
  ) => {
    const listener = (_event: unknown, data: Parameters<typeof callback>[0]) =>
      callback(data);
    ipcRenderer.on("process:output", listener);
    return () => ipcRenderer.removeListener("process:output", listener);
  },
  onProcessDone: (
    callback: (data: {
      id: string;
      backend: string;
      operation: string;
      code: number | null;
      signal: string | null;
    }) => void
  ) => {
    const listener = (_event: unknown, data: Parameters<typeof callback>[0]) =>
      callback(data);
    ipcRenderer.on("process:done", listener);
    return () => ipcRenderer.removeListener("process:done", listener);
  },

  // --- Serial monitor ---
  serialMonitor: (port: string, baudRate: number) =>
    ipcRenderer.invoke("serial:monitor", port, baudRate),
  serialCancel: (processId: string) =>
    ipcRenderer.invoke("serial:cancel", processId),
  onSerialOutput: (
    callback: (data: {
      id: string;
      stream: string;
      text: string;
    }) => void
  ) => {
    const listener = (_event: unknown, data: Parameters<typeof callback>[0]) =>
      callback(data);
    ipcRenderer.on("serial:output", listener);
    return () => ipcRenderer.removeListener("serial:output", listener);
  },
  onSerialDone: (
    callback: (data: {
      id: string;
      code: number | null;
      signal: string | null;
    }) => void
  ) => {
    const listener = (_event: unknown, data: Parameters<typeof callback>[0]) =>
      callback(data);
    ipcRenderer.on("serial:done", listener);
    return () => ipcRenderer.removeListener("serial:done", listener);
  },

  // --- Discovery ---
  deviceListSerial: () => ipcRenderer.invoke("device:list-serial"),

  // --- Health ---
  healthCheck: () => ipcRenderer.invoke("health:check"),
  healthFix: () => ipcRenderer.invoke("health:fix"),

  // --- File dialogs ---
  pickFile: (options: {
    title?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }) => ipcRenderer.invoke("dialog:open-file", options),
  pickDirectory: (options: { title?: string }) =>
    ipcRenderer.invoke("dialog:open-directory", options),
  saveFile: (options: {
    title?: string;
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }) => ipcRenderer.invoke("dialog:save-file", options),

  // --- Shell ---
  shellOpenPath: (fullPath: string) =>
    ipcRenderer.invoke("shell:open-path", fullPath),
  shellShowInFolder: (fullPath: string) =>
    ipcRenderer.invoke("shell:show-item-in-folder", fullPath),

  // --- Store ---
  storePath: () => ipcRenderer.invoke("store:path"),
  outputDir: () => ipcRenderer.invoke("store:output-dir"),
  seedChanges: () => ipcRenderer.invoke("store:seed-changes"),
  applySeed: (id?: string) => ipcRenderer.invoke("store:apply-seed", id),
  dismissSeed: (id: string) => ipcRenderer.invoke("store:dismiss-seed", id),

  // --- HA config files ---
  siteHaList: (siteId: string) =>
    ipcRenderer.invoke("site:ha-list", siteId),
  siteHaLoad: (siteId: string, filename: string) =>
    ipcRenderer.invoke("site:ha-load", siteId, filename),
  siteHaSave: (siteId: string, filename: string, content: string) =>
    ipcRenderer.invoke("site:ha-save", siteId, filename, content),

  // --- Legacy import ---
  legacyHasData: () => ipcRenderer.invoke("legacy:has-data"),
  legacyScan: () => ipcRenderer.invoke("legacy:scan"),
  legacyImport: (sites: LegacyImportResult['sites']) => ipcRenderer.invoke("legacy:import", sites),

  // --- Generation history ---
  generationList: (siteId: string, systemId: string, genType?: string) =>
    ipcRenderer.invoke("generation:list", siteId, systemId, genType),
  generationLoad: (id: number) =>
    ipcRenderer.invoke("generation:load", id),
  generationFind: (version: string) =>
    ipcRenderer.invoke("generation:find", version),
  generationLatest: (siteId: string, systemId: string, genType?: string) =>
    ipcRenderer.invoke("generation:latest", siteId, systemId, genType),

  // --- System secrets ---
  secretsGet: (siteId: string, systemId: string) =>
    ipcRenderer.invoke("secrets:get", siteId, systemId),
  secretsSet: (siteId: string, systemId: string, secrets: Record<string, string>) =>
    ipcRenderer.invoke("secrets:set", siteId, systemId, secrets),

  // --- System settings ---
  settingsGet: (siteId: string, systemId: string, key: string) =>
    ipcRenderer.invoke("settings:get", siteId, systemId, key),
  settingsSet: (siteId: string, systemId: string, key: string, value: string) =>
    ipcRenderer.invoke("settings:set", siteId, systemId, key, value),
  settingsGetAll: (siteId: string, systemId: string) =>
    ipcRenderer.invoke("settings:get-all", siteId, systemId),

  // --- Fleet telemetry & drift detection ---
  driftCheck: (siteId: string) => ipcRenderer.invoke("drift:check", siteId),
  driftHaCheck: () => ipcRenderer.invoke("drift:ha-check"),

  // --- App settings ---
  appSettingGet: (key: string) => ipcRenderer.invoke("app-setting:get", key),
  appSettingSet: (key: string, value: string) => ipcRenderer.invoke("app-setting:set", key, value),

  // --- Topology event log ---
  eventsList: (siteId: string, limit?: number) => ipcRenderer.invoke("events:list", siteId, limit),
  eventsCount: (siteId: string) => ipcRenderer.invoke("events:count", siteId),
  eventsReconstruct: (siteId: string, eventId: number) => ipcRenderer.invoke("events:reconstruct", siteId, eventId),

  // --- Coordinated deployment ---
  deploymentPlan: (siteId: string, targetControllers?: string[]) =>
    ipcRenderer.invoke("deployment:plan", siteId, targetControllers),
  deploymentExecute: (plan: DeploymentPlan) =>
    ipcRenderer.invoke("deployment:execute", plan),
  deploymentRollback: (siteId: string, controllerId: string) =>
    ipcRenderer.invoke("deployment:rollback", siteId, controllerId),

  // --- Product Catalog ---
  catalogList: (category?: string) =>
    ipcRenderer.invoke("catalog:list", category),
  catalogActive: (category?: string) =>
    ipcRenderer.invoke("catalog:active", category),
  catalogGet: (id: string) =>
    ipcRenderer.invoke("catalog:get", id),
  catalogUpsert: (item: {
    id: string;
    category: string;
    sub_category: string | null;
    name: string;
    manufacturer: string;
    manufacturer_pn: string | null;
    specs: string;
    unit_cost_usd: number | null;
    currency: string;
    description: string | null;
    selection_help: string | null;
    reliability_score: number | null;
    is_active: number;
    is_user_defined: number;
  }) => ipcRenderer.invoke("catalog:upsert", item),
  catalogDeactivate: (id: string) =>
    ipcRenderer.invoke("catalog:deactivate", id),

  // --- Site Manifests ---
  manifestList: (siteId: string) =>
    ipcRenderer.invoke("manifest:list", siteId),
  manifestLatest: (siteId: string) =>
    ipcRenderer.invoke("manifest:latest", siteId),
  manifestGet: (siteId: string, version: number) =>
    ipcRenderer.invoke("manifest:get", siteId, version),
  manifestSave: (siteId: string, data: {
    manifest_type: 'quote' | 'deployment' | 'revision';
    topology_checksum?: string;
    customer_name?: string;
    customer_email?: string;
    customer_phone?: string;
    notes?: string;
    items: Array<{ catalogItemId: string; quantity: number; unitPriceAtTime: number; notes?: string }>;
  }) => ipcRenderer.invoke("manifest:save", siteId, data),

  // --- Product Feedback ---
  feedbackList: (catalogId?: string) =>
    ipcRenderer.invoke("feedback:list", catalogId),
  feedbackAdd: (data: {
    catalog_id: string;
    site_id?: string;
    manifest_id?: number;
    deployed_at?: string;
    feedback: string;
    rating?: number;
  }) => ipcRenderer.invoke("feedback:add", data),

  // --- Google Drive Backup ---
  backupAuth: () => ipcRenderer.invoke("backup:auth"),
  backupStatus: () => ipcRenderer.invoke("backup:status"),
  backupUploadSite: (siteId: string) => ipcRenderer.invoke("backup:upload-site", siteId),
  backupUploadDb: () => ipcRenderer.invoke("backup:upload-db"),
});
