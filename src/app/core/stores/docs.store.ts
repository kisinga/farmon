import { Injectable, inject } from '@angular/core';
import { BackendService } from '../services/backend.service';
import type { DocEntry, DocDraft } from '../models/backend-api';
import { CollectionStore } from './collection-store';

/** The DB changes to apply in one import — derived in-browser from dropped files. */
export interface ImportPlan {
  creates: DocDraft[];
  updates: { id: string; draft: DocDraft }[];
  /** Orphans (in DB, not in the import) — pruned only when the user opts in. */
  deletes: { id: string; slug: string }[];
}

/** Outcome of a single doc in an import, for the results summary. */
export interface ImportResult {
  slug: string;
  action: 'created' | 'updated' | 'deleted' | 'error';
  error?: string;
}

/**
 * DocsStore — the `docs` collection (product/node prose). The repo
 * `docs-content/*.md` files are the source of truth; this store is the
 * disposable DB projection the doc assembler reads. It is read-only except for
 * {@link bulkApply}, which syncs the DB from a set of imported files. Low-traffic
 * admin data, so a single reload after the batch is preferred over hand-patching.
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

  /**
   * Apply an import plan: create/update/delete each entry, continue on error
   * (collecting per-doc results), then reload once so the cached list reflects
   * server-rendered fields (id, updated). No transaction by design — there's no
   * sensitive data and the import is idempotent and re-runnable.
   */
  async bulkApply(plan: ImportPlan): Promise<ImportResult[]> {
    const results: ImportResult[] = [];

    for (const draft of plan.creates) {
      try {
        await this.backend.docCreate(draft);
        results.push({ slug: draft.slug, action: 'created' });
      } catch (err) {
        results.push({ slug: draft.slug, action: 'error', error: String(err) });
      }
    }
    for (const { id, draft } of plan.updates) {
      try {
        await this.backend.docSave(id, draft);
        results.push({ slug: draft.slug, action: 'updated' });
      } catch (err) {
        results.push({ slug: draft.slug, action: 'error', error: String(err) });
      }
    }
    for (const { id, slug } of plan.deletes) {
      try {
        await this.backend.docDelete(id);
        results.push({ slug, action: 'deleted' });
      } catch (err) {
        results.push({ slug, action: 'error', error: String(err) });
      }
    }

    await this.reload();
    return results;
  }
}
