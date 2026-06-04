export interface FirmwareSecrets {
  [key: string]: string;
  wifi_ssid: string;
  wifi_password: string;
  ota_password: string;
}

export const EMPTY_FIRMWARE_SECRETS: FirmwareSecrets = {
  wifi_ssid: '',
  wifi_password: '',
  ota_password: '',
};
