import { Injectable, inject } from '@angular/core';
import { BackendService } from '../services/backend.service';
import type { DocEntry, DocDraft } from '../models/backend-api';
import { Cached } from './collection-store';

/**
 * DocsStore — the `docs` collection (admin authoring of product/node prose).
 * Cached list; create/save reload it so server-rendered fields (id, updated
 * timestamp) stay accurate; delete patches in place. Low-traffic admin data,
 * so the reload after a write is preferred over hand-patching every field.
 */
@Injectable({ providedIn: 'root' })
export class DocsStore {
  private backend = inject(BackendService);

  private _list = new Cached<DocEntry[]>(() => this.backend.docList(), []);
  readonly list = this._list.value;
  readonly loading = this._list.loading;
  readonly error = this._list.error;

  ensureLoaded(force = false): Promise<DocEntry[]> {
    return this._list.ensureLoaded(force);
  }
  reload(): Promise<DocEntry[]> {
    return this._list.reload();
  }

  async create(draft: DocDraft): Promise<{ id: string }> {
    const r = await this.backend.docCreate(draft);
    await this._list.reload();
    return r;
  }

  async save(id: string, draft: DocDraft): Promise<void> {
    await this.backend.docSave(id, draft);
    await this._list.reload();
  }

  async delete(id: string): Promise<void> {
    await this.backend.docDelete(id);
    this._list.update((list) => list.filter((d) => d.id !== id));
  }
}
