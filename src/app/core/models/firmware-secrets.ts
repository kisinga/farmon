export interface FirmwareSecrets {
  [key: string]: string;
  wifi_ssid: string;
  wifi_password: string;
  api_key: string;
  ota_password: string;
}

export const EMPTY_FIRMWARE_SECRETS: FirmwareSecrets = {
  wifi_ssid: '',
  wifi_password: '',
  api_key: '',
  ota_password: '',
};

/** True when key decodes to exactly 32 bytes (ESPHome API encryption requirement). */
export function isApiKeyValid(key: string): boolean {
  if (!key) return false;
  try { return atob(key).length === 32; } catch { return false; }
}
