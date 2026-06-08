import type { DeploymentMode } from '../../codegen-ids';

export type GeneratorId = 'esphome';

export interface SecretsMap {
  /** OTA password (ours). Server-managed + stable per controller so OTA works
   *  across rebuilds. The only secret baked into the firmware besides the token. */
  ota_password: string;
  /** Per-controller MQTT token (ours). Verified against controllers.token_hash. */
  mqtt_token: string;
  /** Per-SITE UDP coordination key (ours). Shared by every controller on the site;
   *  keys the HMAC that authenticates cross-controller claims/readings over the LAN
   *  UDP lane. See coordination.ts. */
  udp_key: string;
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
  /** Deployment mode (managed | local) — a location/infra concern: which broker to
   *  bake and which server build fronts the site. The firmware's control AND
   *  coordination code is identical in both modes (cross-controller is LAN UDP,
   *  mode-independent); this only labels the build (the mqtt.yaml header). */
  mode: DeploymentMode;
  /** MQTT broker host the device connects to (cloud broker in managed; on-site
   *  box in local). Baked at generation time. */
  brokerAddress: string;
  /** MQTT broker port (1883 plain / 8883 TLS). */
  brokerPort: number;
  /** Device connects over TLS (8883). When true the firmware embeds `brokerCa`
   *  and verifies the broker; when false it speaks plain TCP. */
  brokerTls: boolean;
  /** PEM of the CA trust anchor the device pins as ESPHome `certificate_authority`
   *  — the issuer that signed the broker's server cert, so leaf rotation needs no
   *  re-flash. Empty when `brokerTls` is false. */
  brokerCa: string;
}
