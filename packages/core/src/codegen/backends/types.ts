export type GeneratorId = 'esphome';

export interface SecretsMap {
  wifi_ssid: string;
  wifi_password: string;
  api_key: string;
  ota_password: string;
}

/** Metadata embedded into generated firmware for fleet telemetry and drift detection. */
export interface GenerationMetadata {
  /** SHA-256 hex digest of topology + board + secrets (input checksum). */
  configSha: string;
  /** Random hex generation version (e.g., "a3f7b2d1"). */
  version: string;
  /** Site ID this generation belongs to. */
  siteId: string;
  /** Controller/system ID this generation belongs to. */
  controllerId: string;
  /** MajiFlow topology schema version. */
  schemaVersion: number;
  /** Unix epoch seconds when the generation was built. */
  buildTimestamp: number;
  /** MajiFlow Electron app version. */
  appVersion: string;
}
