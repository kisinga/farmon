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
 *  collection. The booleans gate BOTH the in-app center filter and the server
 *  email sweep; `channel_email` is the only channel that needs the server. */
export interface NotificationPrefs {
  /** The owning user's record id (== auth user id). */
  user: string;
  alert_device_offline: boolean;
  alert_fault: boolean;
  alert_tank: boolean;
  alert_command_failed: boolean;
  channel_email: boolean;
}

/** Which preference flag gates a given alert type. */
export function prefKeyFor(type: AlertType): keyof NotificationPrefs {
  switch (type) {
    case 'device_offline': return 'alert_device_offline';
    case 'fault': return 'alert_fault';
    case 'tank_low':
    case 'tank_high': return 'alert_tank';
    case 'command_failed': return 'alert_command_failed';
  }
}

export const DEFAULT_NOTIFICATION_PREFS: Omit<NotificationPrefs, 'user'> = {
  alert_device_offline: true,
  alert_fault: true,
  alert_tank: true,
  alert_command_failed: true,
  channel_email: false,
};
