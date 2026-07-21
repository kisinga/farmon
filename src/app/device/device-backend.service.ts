import { Injectable } from '@angular/core';
import type { CommandAction } from '@core';
import { BackendService } from '../core/services/backend.service';
import type { SiteFullPayload } from '../core/models/backend-api';
import { deviceSitePayload } from './device-topology';

/**
 * Mint a UUID v4 for the command envelope. `crypto.randomUUID` is
 * secure-context-only, and the device page is plain `http://192.168.x.x/`, so
 * fall back to `crypto.getRandomValues` (available in insecure contexts) when
 * it is missing.
 */
function mintCommandId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 1
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * DeviceBackendService — the device-mode stand-in for BackendService's two
 * runtime surfaces the dashboard touches:
 *
 *  - `siteLoad` fetches `/topology.json` from the device instead of the `sites`
 *    collection (the device has no PocketBase).
 *  - `sendCommand` POSTs the command envelope straight to the controller's
 *    `/local/command`, minting the `command_id` client-side (in the cloud flow
 *    the server mints it; here the response merely echoes it). Outcomes still
 *    arrive via the snapshot, so the command-lifecycle store is unchanged.
 *
 * Everything else (editor, boards, docs, billing) is unreachable in device mode
 * — the routes that use it are not part of the device build.
 */
@Injectable()
export class DeviceBackendService extends BackendService {
  override async siteLoad(_id: string): Promise<SiteFullPayload> {
    return deviceSitePayload();
  }

  override async sendCommand(
    _siteId: string,
    _controller: string,
    action: CommandAction,
    args: { routeId?: number; nodeId?: string; on?: boolean; key?: string; value?: number; commandId?: string; reclaim?: boolean;
      override_mask?: number; ov_source_min_pct?: number; ov_dest_max_pct?: number;
      ov_max_runtime_min?: number; ov_target_duration_s?: number; ov_target_volume_l?: number } = {},
  ): Promise<string> {
    const commandId = args.commandId ?? mintCommandId();
    // The `/local/command` envelope: only the fields the device knows; undefined
    // entries are dropped (a route_stop carries no node_id, etc.). A reclaim is
    // just a re-assert of the same command_id — the dead-man lease refresh needs
    // no flag of its own here.
    const body: Record<string, unknown> = { command_id: commandId, action };
    const optional: Record<string, unknown> = {
      route_id: args.routeId,
      node_id: args.nodeId,
      on: args.on,
      override_mask: args.override_mask,
      ov_source_min_pct: args.ov_source_min_pct,
      ov_dest_max_pct: args.ov_dest_max_pct,
      ov_max_runtime_min: args.ov_max_runtime_min,
      ov_target_duration_s: args.ov_target_duration_s,
      ov_target_volume_l: args.ov_target_volume_l,
    };
    for (const [k, v] of Object.entries(optional)) {
      if (v !== undefined) body[k] = v;
    }
    const res = await fetch('/local/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Command refused by the device (${res.status}).`);
    return commandId;
  }

  /**
   * Push a packed automation set (the wire blob from src/lib/automation-wire.ts)
   * to the controller. The device-mode UI for editing automations is not wired
   * up yet — this is the transport the contract defines, ready for it.
   */
  async sendAutomations(blob: Uint8Array): Promise<void> {
    const res = await fetch('/local/automations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: blob as BodyInit,
    });
    if (!res.ok) throw new Error(`Automation set refused by the device (${res.status}).`);
  }
}
