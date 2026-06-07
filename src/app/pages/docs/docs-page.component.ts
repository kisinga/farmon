import { Component, computed, effect, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { unknownSlots, vocabFor, ALL_DESCRIPTORS, type DocScope } from '@core';
import { DocsStore } from '../../core/stores/docs.store';
import type { DocEntry } from '../../core/models/backend-api';

const CATEGORIES = ['narrative', 'node', 'wiring', 'glossary'] as const;

/** Accent colour per category, for the list + badges. */
const CAT_COLOR: Record<string, string> = {
  narrative: '#22d3ee', node: '#34d399', wiring: '#fbbf24', glossary: '#a78bfa',
};

/**
 * Documentation authoring (admin). CRUD over the `docs` collection — the product
 * narrative + per-node-kind prose surfaced in every site's documentation. Bodies
 * are markdown with `{{slot}}` placeholders; the editor flags any slot outside
 * the doc's scope vocabulary so a typo or a domain rename surfaces here, not in
 * front of a customer. (Board reference docs live in the board def, not here.)
 */
@Component({
  selector: 'app-docs-page',
  standalone: true,
  imports: [FormsModule],
  host: { class: 'flex-1 overflow-auto' },
  template: `
    <div class="max-w-6xl mx-auto w-full px-6 py-6">
      <!-- Hero -->
      <div class="relative overflow-hidden rounded-2xl mb-6 ring-1 ring-white/10
                  bg-gradient-to-br from-cyan-500/15 via-sky-500/10 to-base-100">
        <div class="pointer-events-none absolute -top-16 -right-10 w-72 h-72 rounded-full bg-cyan-500/20 blur-3xl"></div>
        <div class="relative px-6 py-6 flex items-center gap-3 flex-wrap">
          <div class="flex-1 min-w-0">
            <h1 class="text-2xl font-bold tracking-tight">Documentation</h1>
            <p class="text-sm text-base-content/60 mt-0.5">Product narrative + per-node docs shown in every site's documentation.</p>
          </div>
          <button class="btn btn-primary btn-sm gap-1.5" (click)="newDoc()">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
            New doc
          </button>
        </div>
      </div>

      @if (loading()) {
        <div class="flex items-center justify-center py-24"><span class="loading loading-spinner loading-lg text-cyan-400"></span></div>
      } @else {
        <div class="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
          <!-- List -->
          <div class="space-y-1.5">
            @for (d of docs(); track d.id) {
              <button class="group w-full text-left rounded-xl bg-base-100 ring-1 transition-all hover:-translate-y-px px-3.5 py-2.5 flex items-center gap-3"
                      [class]="selectedId() === d.id ? 'ring-cyan-400/50' : 'ring-base-300/40 hover:ring-base-300/70'"
                      (click)="select(d)">
                <span class="w-1.5 h-8 rounded-full shrink-0" [style.backgroundColor]="catColor(d.category)"></span>
                <div class="min-w-0 flex-1">
                  <div class="text-sm font-medium truncate">{{ d.title || d.slug }}</div>
                  <div class="text-[11px] text-base-content/40 truncate">{{ d.category }} · {{ d.slug }}</div>
                </div>
              </button>
            }
            @if (docs().length === 0) {
              <div class="rounded-xl border border-dashed border-base-300/50 py-10 text-center text-sm text-base-content/40">No docs yet.</div>
            }
          </div>

          <!-- Editor -->
          <div class="rounded-2xl bg-base-100 ring-1 ring-base-300/40 p-5 space-y-4">
            <div class="grid grid-cols-2 gap-3">
              <label class="form-control col-span-2 sm:col-span-1">
                <span class="label-text text-xs text-base-content/60 mb-1">Title</span>
                <input class="input input-bordered input-sm" placeholder="Operation" [(ngModel)]="title" />
              </label>
              @if (category() === 'node') {
                <label class="form-control col-span-2 sm:col-span-1">
                  <span class="label-text text-xs text-base-content/60 mb-1">Node kind <span class="text-base-content/30">(the key)</span></span>
                  <select class="select select-bordered select-sm" [(ngModel)]="slug">
                    <option value="" disabled>Select a kind…</option>
                    @for (k of nodeKinds; track k.kind) { <option [value]="k.kind">{{ k.label }}</option> }
                  </select>
                </label>
              } @else {
                <label class="form-control col-span-2 sm:col-span-1">
                  <span class="label-text text-xs text-base-content/60 mb-1">Slug <span class="text-base-content/30">(the key)</span></span>
                  <input class="input input-bordered input-sm font-mono" placeholder="operation" [(ngModel)]="slug" />
                </label>
              }
              <label class="form-control">
                <span class="label-text text-xs text-base-content/60 mb-1">Category</span>
                <select class="select select-bordered select-sm" [(ngModel)]="category">
                  @for (c of categories; track c) { <option [value]="c">{{ c }}</option> }
                </select>
              </label>
              <label class="form-control">
                <span class="label-text text-xs text-base-content/60 mb-1">Order</span>
                <input type="number" class="input input-bordered input-sm w-24" [(ngModel)]="order" />
              </label>
            </div>

            <!-- Write / Preview -->
            <div>
              <div class="flex items-center justify-between mb-1.5">
                <span class="label-text text-xs text-base-content/60">Body · markdown with {{ slotHint }}</span>
                <div class="join">
                  <button class="btn btn-xs join-item" [class]="mode() === 'write' ? 'btn-active' : 'btn-ghost'" (click)="mode.set('write')">Write</button>
                  <button class="btn btn-xs join-item" [class]="mode() === 'preview' ? 'btn-active' : 'btn-ghost'" (click)="mode.set('preview')">Preview</button>
                </div>
              </div>
              @if (mode() === 'write') {
                <textarea class="textarea textarea-bordered w-full font-mono text-xs leading-relaxed min-h-[360px]" [(ngModel)]="body"></textarea>
              } @else {
                <div class="doc-preview min-h-[360px] rounded-lg border border-base-300/40 bg-white text-black p-5 overflow-auto" [innerHTML]="previewHtml()"></div>
              }
            </div>

            <!-- Drift guard + available slots -->
            <div class="text-[11px] space-y-1">
              @if (drift().length) {
                <div class="text-error flex items-center gap-1.5">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
                  Unknown slots for the <code>{{ scope() }}</code> scope: {{ drift().join(', ') }}
                </div>
              } @else {
                <div class="text-emerald-400">✓ Slots valid for the <code>{{ scope() }}</code> scope.</div>
              }
              <div class="text-base-content/40">Available: {{ vocab().join(', ') }}</div>
            </div>

            <div class="flex items-center gap-3 pt-3 border-t border-base-300/30">
              <button class="btn btn-primary btn-sm" (click)="save()" [disabled]="saving() || !slug() || drift().length > 0">
                @if (saving()) { <span class="loading loading-spinner loading-xs"></span> }
                {{ selectedId() ? 'Save' : 'Create' }}
              </button>
              @if (selectedId()) {
                <button class="btn btn-ghost btn-sm text-error" (click)="remove()" [disabled]="saving()">Delete</button>
              }
              <span class="grow"></span>
              @if (saved()) { <span class="text-xs text-emerald-400">Saved</span> }
              @if (error()) { <span class="text-xs text-error">{{ error() }}</span> }
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .doc-preview :is(h1,h2,h3){ font-weight:600; margin:.6em 0 .3em; }
    .doc-preview h1{ font-size:1.3rem; } .doc-preview h2{ font-size:1.1rem; } .doc-preview h3{ font-size:1rem; }
    .doc-preview p,.doc-preview li{ font-size:.8rem; line-height:1.5; }
    .doc-preview table{ width:100%; border-collapse:collapse; font-size:.72rem; margin:.5em 0; }
    .doc-preview th,.doc-preview td{ border:1px solid #e5e7eb; padding:4px 8px; text-align:left; }
    .doc-preview th{ background:#0c4a6e; color:#fff; }
    .doc-preview code{ background:#f1f5f9; padding:1px 4px; border-radius:3px; font-size:.72rem; }
    .doc-preview blockquote{ border-left:3px solid #bae6fd; padding-left:10px; color:#475569; }
  `],
})
export class DocsPageComponent implements OnInit {
  private docsStore = inject(DocsStore);

  protected readonly categories = CATEGORIES;
  /** Literal `{{slot}}` for the body hint (kept out of Angular interpolation). */
  protected readonly slotHint = '{{slot}}';
  /** Node kinds, loaded from the entity registry — no manual typing. */
  protected readonly nodeKinds = ALL_DESCRIPTORS.map((d) => ({ kind: d.kind, label: d.label }));
  protected loading = signal(true);
  protected saving = signal(false);
  protected saved = signal(false);
  protected error = signal<string | null>(null);

  protected docs = computed(() => this.docsStore.list());
  protected selectedId = signal<string | null>(null);

  protected title = signal('');
  protected slug = signal('');
  protected category = signal<DocEntry['category']>('narrative');
  protected order = signal(0);
  protected body = signal('');

  protected mode = signal<'write' | 'preview'>('write');
  protected previewHtml = signal('');

  protected scope = computed<DocScope>(() => (this.category() === 'node' ? 'node' : 'narrative'));
  protected vocab = computed(() => vocabFor(this.scope()));
  protected drift = computed(() => unknownSlots(this.body(), this.scope()));

  constructor() {
    // Re-render the preview whenever the body changes while previewing.
    effect(() => {
      if (this.mode() !== 'preview') return;
      const src = this.body();
      void this.renderPreview(src);
    });
  }

  protected catColor(c: string): string { return CAT_COLOR[c] ?? '#94a3b8'; }

  private async renderPreview(src: string) {
    // Injected via [innerHTML]: the body is admin-authored (docs write is
    // admin-only) — trusted input. Do not wire this to untrusted content.
    const { previewDoc } = await import('@core/docs');
    if (this.body() !== src) return; // body changed again mid-render
    this.previewHtml.set(await previewDoc(src));
  }

  async ngOnInit() {
    try {
      await this.docsStore.ensureLoaded();
    } catch (err) {
      this.error.set(String(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected newDoc() {
    this.selectedId.set(null);
    this.title.set('');
    this.slug.set('');
    this.category.set('narrative');
    this.order.set(0);
    this.body.set('');
    this.mode.set('write');
    this.saved.set(false);
    this.error.set(null);
  }

  protected select(d: DocEntry) {
    this.selectedId.set(d.id);
    this.title.set(d.title);
    this.slug.set(d.slug);
    this.category.set(d.category);
    this.order.set(d.order);
    this.body.set(d.body);
    this.saved.set(false);
    this.error.set(null);
  }

  async save() {
    if (!this.slug() || this.drift().length > 0) return;
    this.saving.set(true);
    this.saved.set(false);
    this.error.set(null);
    const draft = {
      slug: this.slug(),
      title: this.title(),
      category: this.category(),
      order: this.order(),
      body: this.body(),
    };
    try {
      const id = this.selectedId();
      if (id) {
        await this.docsStore.save(id, draft);
      } else {
        const r = await this.docsStore.create(draft);
        this.selectedId.set(r.id);
      }
      this.saved.set(true);
    } catch (err) {
      this.error.set(String(err));
    } finally {
      this.saving.set(false);
    }
  }

  async remove() {
    const id = this.selectedId();
    if (!id) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.docsStore.delete(id);
      this.newDoc();
    } catch (err) {
      this.error.set(String(err));
    } finally {
      this.saving.set(false);
    }
  }
}
