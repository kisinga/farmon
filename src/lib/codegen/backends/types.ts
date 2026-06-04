import type { DeploymentMode } from '../../codegen-ids';

export type GeneratorId = 'esphome';

export interface SecretsMap {
  wifi_ssid: string;
  wifi_password: string;
  ota_password: string;
  /** Per-controller MQTT token (ours). Verified against controllers.token_hash. */
  mqtt_token: string;
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
  /** MajiFlow app version. */
  appVersion: string;
  /** Runtime mode this firmware is built for — the only mode the device knows. */
  mode: DeploymentMode;
  /** MQTT broker host the device connects to (cloud broker in managed; on-site
   *  box in local). Baked at generation time. */
  brokerAddress: string;
  /** MQTT broker port (1883 plain / 8883 TLS). */
  brokerPort: number;
}
