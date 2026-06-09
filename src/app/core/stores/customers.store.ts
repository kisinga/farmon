import { Injectable, inject } from '@angular/core';
import { BackendService } from '../services/backend.service';
import type { CustomerEntry } from '../models/backend-api';
import { CollectionStore } from './collection-store';

/**
 * CustomersStore — the customer-account catalog (users with role=customer). The
 * admin Customers page reads the cached list; create/update/delete patch it in
 * place. Also feeds the site owner-assignment picker on Overview, so both share
 * one fetch.
 */
@Injectable({ providedIn: 'root' })
export class CustomersStore extends CollectionStore<CustomerEntry[]> {
  private backend = inject(BackendService);
  readonly list = this.value;

  constructor() {
    super([]);
  }
  protected fetch(): Promise<CustomerEntry[]> {
    return this.backend.customerList();
  }

  private sorted(list: CustomerEntry[]): CustomerEntry[] {
    return [...list].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  }

  /** Create a customer and email the invite. Returns whether the invite sent. */
  async create(input: { name: string; email: string }): Promise<{ invited: boolean }> {
    const { customer, invited } = await this.backend.customerCreate(input);
    this.mutate((list) => this.sorted([...list, customer]));
    return { invited };
  }

  async update(id: string, patch: { name: string; email: string }): Promise<void> {
    await this.backend.customerUpdate(id, patch);
    this.mutate((list) => this.sorted(list.map((c) => (c.id === id ? { ...c, ...patch } : c))));
  }

  async remove(id: string): Promise<void> {
    await this.backend.customerDelete(id);
    this.mutate((list) => list.filter((c) => c.id !== id));
  }

  /** (Re)send a customer's set-password invite email. */
  invite(email: string): Promise<void> {
    return this.backend.customerInvite(email);
  }
}
