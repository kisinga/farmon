import { Component, computed, inject, output, signal } from '@angular/core';
import { unknownSlots, type DocScope } from '@core';
import { parseDocFile } from '@core/docs';
import { DocsStore, type ImportPlan, type ImportResult } from '../../core/stores/docs.store';
import type { DocDraft, DocEntry } from '../../core/models/backend-api';
import { docCatColor } from './doc-colors';

const CATEGORIES = ['narrative', 'node', 'wiring', 'glossary'] as const;
type Category = (typeof CATEGORIES)[number];

/** One dropped file, classified against the current DB state. */
interface Row {
  fileName: string;
  slug: string;
  category: string;
  action: 'create' | 'update' | 'skip';
  /** Why a row is skipped (not a doc / unknown category). */
  reason?: string;
  /** Unknown `{{slots}}` for the scope — a warning, never a gate. */
  drift: string[];
  draft?: DocDraft;
  id?: string;
}

/**
 * Bulk import of the source-of-truth `docs-content/*.md` files into the `docs`
 * collection. The repo files own the content; this dialog syncs the DB to match
 * them: drop files → preview a create/update/(prune) plan → confirm. There is no
 * authoring here — content is never typed, only imported.
 */
@Component({
  selector: 'app-docs-import',
  standalone: true,
  template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" (click)="close()">
      <div class="w-full max-w-3xl max-h-[85vh] overflow-auto rounded-2xl bg-base-100 ring-1 ring-base-300/40 shadow-2xl"
           (click)="$event.stopPropagation()">
        <div class="px-6 py-4 border-b border-base-300/30 flex items-center gap-3">
          <h2 class="text-lg font-semibold flex-1">Import documentation</h2>
          <button class="btn btn-ghost btn-sm btn-circle" (click)="close()">✕</button>
        </div>

        <div class="p-6 space-y-4">
          @switch (phase()) {
            <!-- 1. Drop zone -->
            @case ('pick') {
              <p class="text-sm text-base-content/60">
                Drop the <code>docs-content/*.md</code> files (the source of truth). Their
                frontmatter sets slug, title, category and order — nothing is typed here.
              </p>
              <label class="block rounded-2xl border-2 border-dashed py-12 text-center cursor-pointer transition-colors"
                     [class]="dragging() ? 'border-cyan-400/70 bg-cyan-500/5' : 'border-base-300/50 hover:border-base-300/80'"
                     (dragover)="$event.preventDefault(); dragging.set(true)"
                     (dragleave)="dragging.set(false)"
                     (drop)="onDrop($event)">
                <input type="file" accept=".md" multiple class="hidden" (change)="onPick($event)" />
                <div class="text-sm text-base-content/70">Drop <code>.md</code> files here, or click to choose</div>
                <div class="text-[11px] text-base-content/40 mt-1">Files without frontmatter (e.g. README) are skipped.</div>
              </label>
              @if (parseError()) { <div class="text-xs text-error">{{ parseError() }}</div> }
            }

            <!-- 2. Preview / confirm -->
            @case ('preview') {
              <div class="text-sm text-base-content/60">
                {{ creates().length }} new · {{ updates().length }} updated
                @if (skips().length) { · {{ skips().length }} skipped }
              </div>

              <div class="rounded-xl ring-1 ring-base-300/40 divide-y divide-base-300/30 overflow-hidden">
                @for (r of rows(); track r.fileName) {
                  <div class="flex items-center gap-3 px-3.5 py-2 text-sm">
                    <span class="w-1.5 h-7 rounded-full shrink-0" [style.backgroundColor]="catColor(r.category)"></span>
                    <div class="min-w-0 flex-1">
                      <div class="font-mono text-xs truncate">{{ r.fileName }}</div>
                      <div class="text-[11px] text-base-content/40 truncate">
                        {{ r.action === 'skip' ? r.reason : (r.category + ' · ' + r.slug) }}
                      </div>
                      @if (r.drift.length) {
                        <div class="text-[11px] text-warning">⚠ unknown slots: {{ r.drift.join(', ') }}</div>
                      }
                    </div>
                    <span class="badge badge-sm shrink-0"
                          [class]="r.action === 'create' ? 'badge-success' : r.action === 'update' ? 'badge-info' : 'badge-ghost'">
                      {{ r.action }}
                    </span>
                  </div>
                }
              </div>

              <!-- Orphan prune (opt-in) -->
              @if (orphans().length) {
                <label class="flex items-start gap-2.5 rounded-xl bg-base-200/40 p-3 cursor-pointer">
                  <input type="checkbox" class="checkbox checkbox-sm checkbox-warning mt-0.5" [checked]="prune()" (change)="prune.set($any($event.target).checked)" />
                  <span class="text-xs">
                    <span class="font-medium text-warning">Also remove {{ orphans().length }} doc(s)</span>
                    in the database but not in this import:
                    <span class="text-base-content/50">{{ orphanSlugs() }}</span>
                    <span class="block text-base-content/40 mt-0.5">Off by default — only tick this when importing the complete set.</span>
                  </span>
                </label>
              }

              <div class="flex items-center gap-3 pt-2">
                <button class="btn btn-primary btn-sm" (click)="confirm()" [disabled]="applyCount() === 0">
                  Import {{ applyCount() }} doc(s){{ prune() && orphans().length ? ', remove ' + orphans().length : '' }}
                </button>
                <button class="btn btn-ghost btn-sm" (click)="reset()">Choose other files</button>
              </div>
            }

            <!-- 3. Running -->
            @case ('running') {
              <div class="flex items-center justify-center gap-3 py-12 text-sm text-base-content/60">
                <span class="loading loading-spinner loading-md text-cyan-400"></span> Importing…
              </div>
            }

            <!-- 4. Results -->
            @case ('done') {
              <div class="text-sm text-base-content/70">{{ summary() }}</div>
              <div class="rounded-xl ring-1 ring-base-300/40 divide-y divide-base-300/30 overflow-hidden max-h-72 overflow-auto">
                @for (res of results(); track res.slug) {
                  <div class="flex items-center gap-3 px-3.5 py-1.5 text-xs">
                    <span [class]="res.action === 'error' ? 'text-error' : 'text-emerald-400'">
                      {{ res.action === 'error' ? '✗' : '✓' }}
                    </span>
                    <span class="font-mono flex-1 truncate">{{ res.slug }}</span>
                    <span class="text-base-content/50">{{ res.action }}{{ res.error ? ': ' + res.error : '' }}</span>
                  </div>
                }
              </div>
              <div class="flex justify-end pt-2"><button class="btn btn-primary btn-sm" (click)="close()">Done</button></div>
            }
          }
        </div>
      </div>
    </div>
  `,
})
export class DocsImportComponent {
  private docsStore = inject(DocsStore);
  readonly closed = output<void>();

  protected phase = signal<'pick' | 'preview' | 'running' | 'done'>('pick');
  protected dragging = signal(false);
  protected parseError = signal<string | null>(null);
  protected rows = signal<Row[]>([]);
  protected prune = signal(false);
  protected results = signal<ImportResult[]>([]);

  protected creates = computed(() => this.rows().filter((r) => r.action === 'create'));
  protected updates = computed(() => this.rows().filter((r) => r.action === 'update'));
  protected skips = computed(() => this.rows().filter((r) => r.action === 'skip'));
  protected applyCount = computed(() => this.creates().length + this.updates().length);

  /** DB docs whose slug isn't among the valid imported files. */
  protected orphans = computed<DocEntry[]>(() => {
    const incoming = new Set(this.rows().filter((r) => r.action !== 'skip').map((r) => r.slug));
    return this.docsStore.list().filter((d) => !incoming.has(d.slug));
  });
  protected orphanSlugs = computed(() => this.orphans().map((d) => d.slug).join(', '));

  protected catColor(c: string): string { return docCatColor(c); }

  protected onPick(e: Event) {
    const files = (e.target as HTMLInputElement).files;
    if (files) void this.ingest(Array.from(files));
  }

  protected onDrop(e: DragEvent) {
    e.preventDefault();
    this.dragging.set(false);
    const files = e.dataTransfer?.files;
    if (files) void this.ingest(Array.from(files));
  }

  /** Read + classify dropped files into the preview plan. */
  private async ingest(files: File[]) {
    this.parseError.set(null);
    const mdFiles = files.filter((f) => f.name.endsWith('.md'));
    if (mdFiles.length === 0) {
      this.parseError.set('No .md files selected.');
      return;
    }
    const bySlug = new Map(this.docsStore.list().map((d) => [d.slug, d]));
    const rows: Row[] = [];
    for (const file of mdFiles) {
      const parsed = parseDocFile(file.name, await file.text());
      if (!parsed) {
        rows.push({ fileName: file.name, slug: '', category: '', action: 'skip', reason: 'no frontmatter — not a doc', drift: [] });
        continue;
      }
      if (!CATEGORIES.includes(parsed.category as Category)) {
        rows.push({ fileName: file.name, slug: parsed.slug, category: parsed.category, action: 'skip', reason: `unknown category: ${parsed.category}`, drift: [] });
        continue;
      }
      const category = parsed.category as Category;
      const scope: DocScope = category === 'node' ? 'node' : 'narrative';
      const draft: DocDraft = { slug: parsed.slug, title: parsed.title, category, order: parsed.order, body: parsed.body };
      const existing = bySlug.get(parsed.slug);
      rows.push({
        fileName: file.name,
        slug: parsed.slug,
        category,
        action: existing ? 'update' : 'create',
        drift: unknownSlots(parsed.body, scope),
        draft,
        id: existing?.id,
      });
    }
    this.rows.set(rows);
    this.phase.set('preview');
  }

  protected async confirm() {
    const plan: ImportPlan = {
      creates: this.creates().map((r) => r.draft!),
      updates: this.updates().map((r) => ({ id: r.id!, draft: r.draft! })),
      deletes: this.prune() ? this.orphans().map((d) => ({ id: d.id, slug: d.slug })) : [],
    };
    this.phase.set('running');
    this.results.set(await this.docsStore.bulkApply(plan));
    this.phase.set('done');
  }

  protected summary(): string {
    const r = this.results();
    const n = (a: ImportResult['action']) => r.filter((x) => x.action === a).length;
    const parts = [`${n('created')} created`, `${n('updated')} updated`];
    if (n('deleted')) parts.push(`${n('deleted')} removed`);
    if (n('error')) parts.push(`${n('error')} failed`);
    return parts.join(' · ');
  }

  protected reset() {
    this.rows.set([]);
    this.prune.set(false);
    this.parseError.set(null);
    this.phase.set('pick');
  }

  protected close() { this.closed.emit(); }
}
