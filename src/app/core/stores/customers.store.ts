import { Injectable, inject } from '@angular/core';
import { BackendService } from '../services/backend.service';
import type { CustomerEntry } from '../models/backend-api';
import { Cached } from './collection-store';

/**
 * CustomersStore — the customer-account catalog (users with role=customer). The
 * admin Customers page reads the cached list; create/update/delete patch it in
 * place. Also feeds the site owner-assignment picker on Overview, so both share
 * one fetch.
 */
@Injectable({ providedIn: 'root' })
export class CustomersStore {
  private backend = inject(BackendService);

  private _list = new Cached<CustomerEntry[]>(() => this.backend.customerList(), []);
  readonly list = this._list.value;
  readonly loading = this._list.loading;
  readonly error = this._list.error;

  ensureLoaded(force = false): Promise<CustomerEntry[]> {
    return this._list.ensureLoaded(force);
  }
  reload(): Promise<CustomerEntry[]> {
    return this._list.reload();
  }

  private sorted(list: CustomerEntry[]): CustomerEntry[] {
    return [...list].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  }

  /** Create a customer and email the invite. Returns whether the invite sent. */
  async create(input: { name: string; email: string }): Promise<{ invited: boolean }> {
    const { customer, invited } = await this.backend.customerCreate(input);
    this._list.update((list) => this.sorted([...list, customer]));
    return { invited };
  }

  async update(id: string, patch: { name: string; email: string }): Promise<void> {
    await this.backend.customerUpdate(id, patch);
    this._list.update((list) => this.sorted(list.map((c) => (c.id === id ? { ...c, ...patch } : c))));
  }

  async remove(id: string): Promise<void> {
    await this.backend.customerDelete(id);
    this._list.update((list) => list.filter((c) => c.id !== id));
  }

  /** (Re)send a customer's set-password invite email. */
  invite(email: string): Promise<void> {
    return this.backend.customerInvite(email);
  }
}
