import { Component, inject, OnInit, signal } from '@angular/core';
import { BackendService } from '../../core/services/backend.service';
import { SectionHeaderComponent } from '../editor/shared/section-header.component';

type BoardKind = 'main' | 'expansion';

@Component({
  selector: 'app-boards-page',
  standalone: true,
  imports: [SectionHeaderComponent],
  host: { class: 'flex-1 overflow-auto' },
  template: `
    <div class="content-pane space-y-6">
      <div class="flex items-start justify-between gap-4 flex-wrap">
        <app-section-header title="Boards" subtitle="Supported controller boards and expansions." />
        @if (backend.isAdmin) {
          <button class="btn btn-sm rounded-full border-0 bg-cyan-400 text-slate-950 hover:bg-cyan-300 shrink-0" (click)="toggleImport()">
            {{ showImport() ? 'Cancel' : 'Import board' }}
          </button>
        }
      </div>

      @if (showImport()) {
        <div class="card bg-base-100 border border-base-300/50 mb-8">
          <div class="card-body gap-4">
            <h2 class="card-title text-sm">Import board from JSON</h2>

            <div class="flex gap-4 text-sm">
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="radio" class="radio radio-sm" name="kind"
                  [checked]="kind() === 'expansion'" (change)="kind.set('expansion')" />
                Expansion (pure data)
              </label>
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="radio" class="radio radio-sm" name="kind"
                  [checked]="kind() === 'main'" (change)="kind.set('main')" />
                Main controller (needs SVG)
              </label>
            </div>

            <label class="text-xs text-base-content/50">
              Board definition (.json)
              <input type="file" accept=".json"
                class="file-input file-input-bordered file-input-sm w-full mt-1"
                (change)="onJsonFile($event)" />
            </label>

            @if (kind() === 'main') {
              <label class="text-xs text-base-content/50">
                Board diagram (SVG, required)
                <input type="file" accept="image/svg+xml"
                  class="file-input file-input-bordered file-input-sm w-full mt-1"
                  (change)="onSvgFile($event)" />
              </label>
            }

            @if (error()) {
              <div class="alert alert-error text-xs py-2">{{ error() }}</div>
            }

            <div class="flex justify-end">
              <button class="btn btn-sm btn-primary"
                [disabled]="importing() || !defText().trim()"
                (click)="doImport()">
                {{ importing() ? 'Importing…' : 'Import' }}
              </button>
            </div>
          </div>
        </div>
      }

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        @for (b of boards(); track b.model) {
          <div class="card bg-base-100 border border-base-300/50">
            <div class="card-body">
              <h2 class="card-title text-sm">{{ b.label }}</h2>
              <p class="text-xs text-base-content/50 font-mono">{{ b.model }}</p>
            </div>
          </div>
        }
      </div>
    </div>
  `,
})
export class BoardsPageComponent implements OnInit {
  protected backend = inject(BackendService);
  boards = signal<Array<{ model: string; label: string }>>([]);

  protected showImport = signal(false);
  protected kind = signal<BoardKind>('expansion');
  protected defText = signal('');
  protected importing = signal(false);
  protected error = signal<string | null>(null);
  private svgFile: File | null = null;

  async ngOnInit() {
    await this.refresh();
  }

  private async refresh() {
    const list = await this.backend.boardList();
    this.boards.set(list.map((b) => ({ model: b.model, label: b.label })));
  }

  protected toggleImport() {
    this.showImport.update((v) => !v);
    this.error.set(null);
  }

  protected async onJsonFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) this.defText.set(await file.text());
  }

  protected onSvgFile(event: Event) {
    this.svgFile = (event.target as HTMLInputElement).files?.[0] ?? null;
  }

  protected async doImport() {
    this.importing.set(true);
    this.error.set(null);
    try {
      await this.backend.boardImport(
        this.defText(),
        this.kind(),
        this.svgFile ?? undefined,
      );
      await this.refresh();
      this.showImport.set(false);
      this.defText.set('');
      this.svgFile = null;
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.importing.set(false);
    }
  }
}
