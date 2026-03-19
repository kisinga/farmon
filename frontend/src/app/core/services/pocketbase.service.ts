import { Injectable } from '@angular/core';
import PocketBase from 'pocketbase';

/**
 * Base URL for the PocketBase SDK: origin only. The SDK appends /api/collections/...
 * itself, so the base must NOT include /api (otherwise you get /api/api/collections/...).
 */
function getApiBaseUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return '';
}

@Injectable({ providedIn: 'root' })
export class PocketBaseService {
  readonly pb = new PocketBase(getApiBaseUrl());

  constructor() {
    this.initAuth();
  }

  /**
   * Authenticates the frontend service user with PocketBase.
   * Credentials are fetched from the backend (set on first server run).
   * The PocketBase SDK persists the auth token in localStorage and auto-refreshes it,
   * so subsequent page loads skip the auth call if the token is still valid.
   */
  private async initAuth(): Promise<void> {
    if (this.pb.authStore.isValid) return;
    try {
      const res = await fetch('/api/farmon/ui-config');
      if (!res.ok) throw new Error(`ui-config: ${res.status}`);
      const { email, password } = await res.json();
      await this.pb.collection('users').authWithPassword(email, password);
    } catch (e) {
      console.error('[farmon] PocketBase auth failed', e);
    }
  }
}
