import { Injectable, inject, signal } from '@angular/core';
import { BackendService } from './backend.service';
import { DEVICE_MODE } from '../tokens/device-mode';
import type { UserRole } from './auth.store';

export interface PersonaSwitch {
  role: UserRole;
  /** Org to point users.partner at; omitted keeps the current assignment. */
  partner?: string;
  /** Site whose owner list the caller joins (grantSite) or leaves. */
  site?: string;
  grantSite?: boolean;
}

/**
 * PersonaService — client for the dev-only persona switcher
 * (`/api/farmon/persona`, gated server-side by the MAJI_PERSONA_EMAILS
 * allowlist). The probe runs once at bootstrap; a 404 (feature off or the
 * caller's email not allowlisted) leaves `enabled` false and the navbar
 * switcher hidden — zero footprint in production. A switch POSTs, refreshes
 * the cached auth record (the old role would otherwise ride the reload), then
 * hard-reloads so every guard/store comes up under the new persona.
 */
@Injectable({ providedIn: 'root' })
export class PersonaService {
  private backend = inject(BackendService);
  private get pb() {
    return this.backend.pb;
  }

  /** True when the server says the caller may switch personas. */
  readonly enabled = signal(false);
  /** True while a switch request is in flight (the page reloads on success). */
  readonly switching = signal(false);

  constructor() {
    // The device build has no /api/farmon backend — stay hidden, no probe.
    if (!inject(DEVICE_MODE)) void this.probe();
  }

  private async probe(): Promise<void> {
    if (!this.pb.authStore.isValid) return;
    try {
      const r = await this.pb.send<{ enabled?: boolean }>('/api/farmon/persona', { method: 'GET' });
      this.enabled.set(!!r.enabled);
    } catch {
      // 404 when MAJI_PERSONA_EMAILS is unset or excludes the caller — hidden.
    }
  }

  /** Apply a persona to the caller's own account, then reload the app. */
  async switch(input: PersonaSwitch): Promise<void> {
    this.switching.set(true);
    await this.pb.send('/api/farmon/persona', {
      method: 'POST',
      body: {
        role: input.role,
        partner: input.partner,
        site: input.site,
        grant_site: input.grantSite,
      },
    });
    // The cached auth record still holds the old role; refresh it so the
    // reload boots under the new persona.
    await this.pb.collection('users').authRefresh();
    document.location.reload();
  }
}
