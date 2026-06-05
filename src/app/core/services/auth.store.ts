import { Injectable, computed, inject, signal } from '@angular/core';
import { BackendService } from './backend.service';

export type UserRole = 'admin' | 'customer';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

/**
 * AuthStore — reactive view of the PocketBase auth session for the UI.
 *
 * Components and the nav read these signals; the route guards read
 * `pb.authStore` directly (they run outside the injection-reactivity context).
 * Shared state group — safe for both admin and customer pages.
 */
@Injectable({ providedIn: 'root' })
export class AuthStore {
  private backend = inject(BackendService);
  private get pb() {
    return this.backend.pb;
  }

  readonly user = signal<AuthUser | null>(this.read());
  readonly isAuthenticated = computed(() => this.user() !== null);
  readonly isAdmin = computed(() => this.user()?.role === 'admin');
  readonly role = computed<UserRole | null>(() => this.user()?.role ?? null);

  constructor() {
    // Keep the signal in lockstep with the PB session (login, logout, refresh).
    this.pb.authStore.onChange(() => this.user.set(this.read()));
  }

  async login(email: string, password: string): Promise<void> {
    await this.pb.collection('users').authWithPassword(email, password);
  }

  logout(): void {
    this.pb.authStore.clear();
  }

  private read(): AuthUser | null {
    const r = this.pb.authStore.record;
    if (!this.pb.authStore.isValid || !r) return null;
    return {
      id: r.id,
      email: r['email'] ?? '',
      role: r['role'] === 'admin' ? 'admin' : 'customer',
    };
  }
}
