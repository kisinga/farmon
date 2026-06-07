import { Component, input, output, signal, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

import { ApiService } from '../../../core/services/api.service';
import { ConfigContextService } from '../../../core/services/config-context.service';
import { DeviceSpec } from '../../../core/services/api.types';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog.component';

/**
 * SpecJsonModalComponent — load/export device specification JSON.
 *
 * Export: fetches the current spec and shows it in a textarea with a copy button.
 * Import: pastes JSON, confirms "this will replace all current config", applies spec.
 */
@Component({
  selector: 'app-spec-json-modal',
  standalone: true,
  imports: [FormsModule, CommonModule, ConfirmDialogComponent],
  template: `
    @if (open()) {
      <div class="modal modal-open">
        <div class="modal-box max-w-2xl">
          <h3 class="font-bold text-lg">Device Specification JSON</h3>
          <p class="text-xs text-base-content/60 mt-1">
            Export the current config as JSON, or paste a spec to replace all settings.
          </p>

          <!-- Tabs -->
          <div class="tabs tabs-boxed mt-4 mb-3">
            <button class="tab" [class.tab-active]="mode() === 'export'" (click)="setMode('export')">Export</button>
            <button class="tab" [class.tab-active]="mode() === 'import'" (click)="setMode('import')">Import</button>
          </div>

          <!-- Export mode -->
          @if (mode() === 'export') {
            @if (specLoading()) {
              <div class="flex justify-center py-8">
                <span class="loading loading-spinner loading-sm"></span>
              </div>
            } @else {
              <div class="relative">
                <textarea class="textarea textarea-bordered w-full font-mono text-xs h-72"
                  [value]="specJson()" readonly>
                </textarea>
                <button
                  class="btn btn-xs btn-ghost absolute top-2 right-2"
                  (click)="copyJson()"
                >{{ copied() ? 'Copied!' : 'Copy' }}</button>
              </div>
            }
          }

          <!-- Import mode -->
          @if (mode() === 'import') {
            <div class="space-y-3">
              <textarea class="textarea textarea-bordered w-full font-mono text-xs h-72"
                [(ngModel)]="importJson"
                placeholder="Paste device spec JSON here...">
              </textarea>
              @if (importError()) {
                <div class="alert alert-error text-xs py-2">{{ importError() }}</div>
              }
              <div class="alert alert-warning text-xs py-2">
                <span>Applying a spec will replace ALL current inputs, outputs, variables, and decode rules for this device.</span>
              </div>
              <button
                class="btn btn-sm btn-warning"
                (click)="confirmApply.set(true)"
                [disabled]="!importJson.trim() || applying()"
              >
                Apply Spec
              </button>
            </div>
          }

          <!-- Message -->
          @if (specMessage()) {
            <div class="alert text-xs py-2 mt-3"
              [class.alert-error]="specIsError()"
              [class.alert-success]="!specIsError()">
              {{ specMessage() }}
            </div>
          }

          <div class="modal-action">
            <button class="btn btn-ghost btn-sm" (click)="closed.emit()">Close</button>
          </div>
        </div>
        <div class="modal-backdrop" (click)="closed.emit()"></div>
      </div>

      <!-- Apply confirmation -->
      <app-confirm-dialog
        [open]="confirmApply()"
        title="Apply device spec?"
        message="This will replace ALL current configuration (inputs, outputs, variables, decode rules). This action cannot be undone."
        confirmLabel="Apply"
        [dangerMode]="true"
        (confirmed)="executeApply()"
        (cancelled)="confirmApply.set(false)"
      />
    }
  `,
})
export class SpecJsonModalComponent {
  open = input<boolean>(false);
  closed = output<void>();

  private api = inject(ApiService);
  protected ctx = inject(ConfigContextService);

  mode = signal<'export' | 'import'>('export');
  specJson = signal('');
  specLoading = signal(false);
  importJson = '';
  importError = signal<string | null>(null);
  applying = signal(false);
  specMessage = signal<string | null>(null);
  specIsError = signal(false);
  copied = signal(false);
  confirmApply = signal(false);

  setMode(m: 'export' | 'import'): void {
    this.mode.set(m);
    if (m === 'export' && !this.specJson()) {
      this.loadSpec();
    }
    this.specMessage.set(null);
    this.importError.set(null);
  }

  private loadSpec(): void {
    const eui = this.ctx.eui();
    if (!eui) return;
    this.specLoading.set(true);
    this.api.getDeviceSpec(eui).subscribe({
      next: (spec) => {
        this.specJson.set(JSON.stringify(spec, null, 2));
        this.specLoading.set(false);
      },
      error: (err) => {
        this.specLoading.set(false);
        this.specIsError.set(true);
        this.specMessage.set(err?.message ?? 'Failed to load spec');
      },
    });
  }

  // Reload spec when modal opens in export mode
  ngOnChanges(): void {
    if (this.open() && this.mode() === 'export') {
      this.specJson.set('');
      this.loadSpec();
    }
  }

  copyJson(): void {
    navigator.clipboard.writeText(this.specJson()).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
  }

  executeApply(): void {
    this.confirmApply.set(false);
    this.importError.set(null);

    let spec: DeviceSpec;
    try {
      spec = JSON.parse(this.importJson);
    } catch {
      this.importError.set('Invalid JSON — check your paste.');
      return;
    }

    const eui = this.ctx.eui();
    if (!eui) return;
    this.applying.set(true);
    this.api.applyDeviceSpec(eui, spec).subscribe({
      next: () => {
        this.applying.set(false);
        this.specIsError.set(false);
        this.specMessage.set('Spec applied successfully. Reloading config…');
        this.importJson = '';
        this.ctx.reloadAll();
      },
      error: (err) => {
        this.applying.set(false);
        this.specIsError.set(true);
        this.importError.set(err?.error?.message ?? err?.message ?? 'Failed to apply spec');
      },
    });
  }
}
