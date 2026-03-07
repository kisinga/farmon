import { Component, inject, input, signal } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { DeviceContextService } from '../../../core/services/device-context.service';
import { ControlRowComponent } from '../control-row/control-row.component';

@Component({
  selector: 'app-controls-panel',
  standalone: true,
  imports: [ControlRowComponent],
  template: `
    <div class="space-y-2">
      <h3 class="text-lg font-semibold">Controls</h3>
      @if (message()) {
        <p class="text-sm" [class.text-error]="isError()" [class.text-success]="!isError()">{{ message() }}</p>
      }
      @for (ctrl of controls(); track ctrl.id) {
        <app-control-row
          [controlKey]="ctrl.control_key"
          [currentState]="ctrl.current_state"
          [showClear]="true"
          [withDuration]="true"
          (setState)="onSetState(ctrl.control_key, $event)"
          (clearOverride)="onClearOverride(ctrl.control_key)"
        />
      }
      @if (controls().length === 0 && !loading()) {
        <p class="text-base-content/60 text-sm">No controls defined. They may appear after device registration or state updates.</p>
      }
    </div>
  `,
})
export class ControlsPanelComponent {
  private api = inject(ApiService);
  private deviceContext = inject(DeviceContextService);

  eui = input.required<string>();
  message = signal<string | null>(null);
  isError = signal(false);

  controls = this.deviceContext.controls;
  loading = this.deviceContext.loading;

  onSetState(controlKey: string, ev: { state: string; duration?: number }): void {
    const eui = this.eui();
    if (!eui) return;
    this.message.set(null);
    this.api.setControl(eui, controlKey, ev.state, ev.duration).subscribe({
      next: () => {
        this.isError.set(false);
        this.message.set('Command queued.');
        this.deviceContext.load(eui);
      },
      error: (err) => {
        this.isError.set(true);
        this.message.set(err?.error?.error ?? err?.message ?? 'Failed to set control');
      },
    });
  }

  onClearOverride(controlKey: string): void {
    const eui = this.eui();
    if (!eui) return;
    this.message.set(null);
    this.api.setControl(eui, controlKey, 'off').subscribe({
      next: () => {
        this.isError.set(false);
        this.message.set('Override cleared.');
        this.deviceContext.load(eui);
      },
      error: (err) => {
        this.isError.set(true);
        this.message.set(err?.error?.error ?? err?.message ?? 'Failed to clear override');
      },
    });
  }
}
