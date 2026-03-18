import { Component, inject, input, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, FirmwareCommand } from '../../../core/services/api.service';
import { DeviceContextService } from '../../../core/services/device-context.service';
import { ControlRowComponent } from '../control-row/control-row.component';

@Component({
  selector: 'app-controls-panel',
  standalone: true,
  imports: [ControlRowComponent, FormsModule],
  template: `
    <div class="space-y-6">
      <div class="space-y-4">
        <h2 class="section-title">Controls</h2>
        @if (message()) {
          <div class="alert text-sm rounded-xl" [class.alert-error]="isError()" [class.alert-success]="!isError()">
            <span>{{ message() }}</span>
          </div>
        }
        <div class="space-y-3">
        @for (ctrl of controls(); track ctrl.id) {
          <app-control-row
            [controlKey]="ctrl.control_key"
            [currentState]="ctrl.current_state"
            [displayName]="ctrl.display_name || ctrl.control_key"
            [stateNames]="ctrl.states_json || []"
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
      </div>

      @if (firmwareCommands().length > 0) {
        <div class="space-y-3">
          <h2 class="section-title">Commands</h2>
          @if (cmdMessage()) {
            <div class="alert text-sm rounded-xl" [class.alert-error]="cmdIsError()" [class.alert-success]="!cmdIsError()">
              <span>{{ cmdMessage() }}</span>
            </div>
          }
          <div class="flex flex-wrap gap-2">
            @for (cmd of firmwareCommands(); track cmd.command_key) {
              <div class="flex items-center gap-1">
                <button
                  class="btn btn-sm btn-outline"
                  [title]="cmd.description || cmd.command_key"
                  [disabled]="sendingCmd() === cmd.command_key"
                  (click)="cmd.payload_type === 'uint32' ? null : sendCommand(cmd.command_key)"
                >
                  @if (sendingCmd() === cmd.command_key) {
                    <span class="loading loading-spinner loading-xs"></span>
                  }
                  {{ cmd.name }}
                </button>
                @if (cmd.payload_type === 'uint32') {
                  <input type="number" class="input input-bordered input-xs w-20"
                    [(ngModel)]="cmdValues[cmd.command_key]" placeholder="value" />
                  <button class="btn btn-sm btn-outline"
                    [disabled]="sendingCmd() === cmd.command_key"
                    (click)="sendCommand(cmd.command_key, cmdValues[cmd.command_key])">
                    Send
                  </button>
                }
              </div>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class ControlsPanelComponent implements OnInit {
  private api = inject(ApiService);
  private deviceContext = inject(DeviceContextService);

  eui = input.required<string>();
  message = signal<string | null>(null);
  isError = signal(false);
  cmdMessage = signal<string | null>(null);
  cmdIsError = signal(false);
  sendingCmd = signal<string | null>(null);
  firmwareCommands = signal<FirmwareCommand[]>([]);
  cmdValues: Record<string, number> = {};

  controls = this.deviceContext.controls;
  loading = this.deviceContext.loading;

  ngOnInit(): void {
    this.api.getFirmwareCommands().subscribe({
      next: (list) => this.firmwareCommands.set(list),
      error: () => this.firmwareCommands.set([]),
    });
  }

  sendCommand(key: string, value?: number): void {
    const eui = this.eui();
    if (!eui) return;
    this.cmdMessage.set(null);
    this.sendingCmd.set(key);
    this.api.sendCommand(eui, key, value).subscribe({
      next: () => { this.sendingCmd.set(null); this.cmdIsError.set(false); this.cmdMessage.set('Command queued.'); },
      error: (err) => { this.sendingCmd.set(null); this.cmdIsError.set(true); this.cmdMessage.set(err?.error?.error ?? 'Failed'); },
    });
  }

  onSetState(controlKey: string, ev: { state: string; duration?: number }): void {
    const eui = this.eui();
    if (!eui) return;
    this.message.set(null);
    this.api.setControl(eui, controlKey, ev.state, ev.duration).subscribe({
      next: () => {
        this.isError.set(false);
        this.message.set('Command queued.');
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
    // Use first registered state (index 0) as default/off state
    const ctrl = this.deviceContext.controlsMap().get(controlKey);
    const defaultState = ctrl?.states_json?.[0] ?? 'off';
    this.api.setControl(eui, controlKey, defaultState).subscribe({
      next: () => {
        this.isError.set(false);
        this.message.set('Override cleared.');
      },
      error: (err) => {
        this.isError.set(true);
        this.message.set(err?.error?.error ?? err?.message ?? 'Failed to clear override');
      },
    });
  }
}
