/**
 * Alert model — the read side of the in-app notification center.
 *
 * Alerts are NOT stored: they are DERIVED in the browser from realtime data the
 * app already streams (controller presence, transition events, tank-level
 * shadows) against per-site thresholds. A `DerivedAlert` is therefore a snapshot
 * of a currently-active condition, identified by a stable `key` so it can be
 * acknowledged and deduped across recomputations. The server runs its own
 * minimal copy of this detection purely to send email while no tab is open.
 */

export type AlertType =
  | 'device_offline'
  | 'fault'
  | 'tank_low'
  | 'tank_high'
  | 'run_start'
  | 'run_stop'
  | 'command_failed';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface DerivedAlert {
  /** Stable identity for dedup + ack persistence, e.g. `fault:ctrlA:2`. A
   *  state-based alert keeps its key for as long as the condition holds, so an
   *  ack sticks until it clears and a re-occurrence re-notifies. */
  key: string;
  type: AlertType;
  severity: AlertSeverity;
  site: string;
  siteName: string;
  controller: string;
  /** Short headline, e.g. "Controller offline". */
  title: string;
  /** One-line detail, e.g. "Main Tank at 14% (low 20%)". */
  message: string;
  /** When the condition was last observed (epoch ms), for sorting + "x ago". */
  ts: number;
  /** The channel the alert concerns, when applicable (tank thresholds). */
  sensor?: string;
}

/** Per-user notification routing, persisted in the `notification_prefs`
 *  collection. The alert booleans gate BOTH the in-app center filter and the
 *  server external-alert sweep; WhatsApp/email channels need the server. */
export interface NotificationPrefs {
  /** The owning user's record id (== auth user id). */
  user: string;
  alert_device_offline: boolean;
  alert_fault: boolean;
  alert_tank: boolean;
  alert_run_start: boolean;
  alert_run_stop: boolean;
  alert_command_failed: boolean;
  channel_whatsapp: boolean;
  /** OpenWA chat id (`2547...@c.us`) or a phone number the server normalises. */
  whatsapp_chat_id: string;
  /** International dial code used when a local phone number is entered. */
  whatsapp_country_code: string;
  channel_email: boolean;
}

/** Which preference flag gates a given alert type. */
export function prefKeyFor(type: AlertType): keyof NotificationPrefs {
  switch (type) {
    case 'device_offline': return 'alert_device_offline';
    case 'fault': return 'alert_fault';
    case 'tank_low':
    case 'tank_high': return 'alert_tank';
    case 'run_start': return 'alert_run_start';
    case 'run_stop': return 'alert_run_stop';
    case 'command_failed': return 'alert_command_failed';
  }
}

// Defaults for an unconfigured user. Most alert types default ON, but
// `alert_device_offline` is OPT-IN (noisy on flaky links) and the run-transition
// types are OPT-IN because they can fire frequently on automated schedules.
export const DEFAULT_NOTIFICATION_PREFS: Omit<NotificationPrefs, 'user'> = {
  alert_device_offline: false,
  alert_fault: true,
  alert_tank: true,
  alert_run_start: false,
  alert_run_stop: false,
  alert_command_failed: true,
  // WhatsApp is the primary external channel for this deployment, so it defaults
  // on. The backend falls back to users.phone when no dedicated chat id is set.
  channel_whatsapp: true,
  whatsapp_chat_id: '',
  whatsapp_country_code: '254',
  channel_email: false,
};

/** The single "no data this long → offline" threshold, in seconds. Applied for a
 *  site that hasn't set its own `offline_timeout_s` (the 0/unset sentinel). */
export const OFFLINE_DEFAULT_S = 180;
/** Floor for a positive `offline_timeout_s`: it must stay well above the telemetry
 *  cadence (update_interval, capped at 60s) so a healthy device's normal gap
 *  between samples can never read as offline and flap the dashboard/alerts. */
export const OFFLINE_FLOOR_S = 120;

/** Resolve a site's configured `offline_timeout_s` (seconds) to milliseconds — the
 *  ONE freshness/staleness window shared by the dashboard presence check, the alert
 *  bell, and (mirrored) the backend email sweep. 0/unset → default; a positive value
 *  is floored at {@link OFFLINE_FLOOR_S}. Mirror of resolveSite() in
 *  maji-server/internal/alerts/email_sweep.go — keep both in sync. */
export function resolveOfflineMs(rawSeconds: number | null | undefined): number {
  const s = Number(rawSeconds);
  if (!Number.isFinite(s) || s <= 0) return OFFLINE_DEFAULT_S * 1000;
  return Math.max(s, OFFLINE_FLOOR_S) * 1000;
}

/** Per-site alert thresholds and display name, derived from the sites catalog. */
export interface SiteAlertConfig {
  name: string;
  lowPct: number;
  highPct: number | null;
  offlineMs: number;
}
