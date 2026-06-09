import { Injectable, inject } from '@angular/core';
import { BackendService } from '../services/backend.service';
import type { DocEntry, DocDraft } from '../models/backend-api';
import { CollectionStore } from './collection-store';

/**
 * DocsStore — the `docs` collection (admin authoring of product/node prose).
 * Cached list; create/save reload it so server-rendered fields (id, updated
 * timestamp) stay accurate; delete patches in place. Low-traffic admin data,
 * so the reload after a write is preferred over hand-patching every field.
 */
@Injectable({ providedIn: 'root' })
export class DocsStore extends CollectionStore<DocEntry[]> {
  private backend = inject(BackendService);
  readonly list = this.value;

  constructor() {
    super([]);
  }
  protected fetch(): Promise<DocEntry[]> {
    return this.backend.docList();
  }

  async create(draft: DocDraft): Promise<{ id: string }> {
    const r = await this.backend.docCreate(draft);
    await this.reload();
    return r;
  }

  async save(id: string, draft: DocDraft): Promise<void> {
    await this.backend.docSave(id, draft);
    await this.reload();
  }

  async delete(id: string): Promise<void> {
    await this.backend.docDelete(id);
    this.mutate((list) => list.filter((d) => d.id !== id));
  }
}
