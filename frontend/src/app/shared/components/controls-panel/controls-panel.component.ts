import { Component, inject, input, signal, computed, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, DeviceField, FirmwareCommand } from '../../../core/services/api.service';
import { DeviceContextService } from '../../../core/services/device-context.service';
import { ControlRowComponent } from '../control-row/control-row.component';

@Component({
  selector: 'app-controls-panel',
  standalone: true,
  imports: [ControlRowComponent, FormsModule],
  template: `
    <div class="space-y-6">
      <!-- Controls -->
      <div class="space-y-4">
        <h2 class="section-title">Controls</h2>
        <p class="text-xs text-base-content/50 -mt-2">Stateful outputs that can be toggled via commands, rules, or workflows.</p>
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

      <!-- Settings (writable fields) -->
      @if (writableFields().length > 0) {
        <div class="space-y-4">
          <h2 class="section-title">Settings</h2>
          <p class="text-xs text-base-content/50 -mt-2">Writable fields that can be updated via downlink commands.</p>
          @if (settingsMessage()) {
            <div class="alert text-sm rounded-xl" [class.alert-error]="settingsIsError()" [class.alert-success]="!settingsIsError()">
              <span>{{ settingsMessage() }}</span>
            </div>
          }
          <div class="space-y-3">
            @for (f of writableFields(); track f.field_key) {
              <div class="flex flex-wrap items-center gap-3 rounded-xl border border-base-300 bg-base-200/30 p-4">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="font-semibold">{{ f.display_name || f.field_key }}</span>
                  @if (f.unit) {
                    <span class="badge badge-ghost badge-sm">{{ f.unit }}</span>
                  }
                  @if (currentValue(f.field_key) !== null) {
                    <span class="text-sm text-base-content/60">Current: {{ currentValue(f.field_key) }}</span>
                  }
                </div>
                <div class="flex items-center gap-2">
                  <input
                    type="number"
                    class="input input-bordered input-sm w-28"
                    [min]="f.min_value ?? 0"
                    [max]="f.max_value ?? 999999"
                    [placeholder]="f.display_name || f.field_key"
                    [value]="getFieldInput(f.field_key)"
                    (input)="setFieldInput(f.field_key, $any($event.target).value)"
                  />
                  <button
                    type="button"
                    class="btn btn-sm btn-primary"
                    [disabled]="sendingSetting()"
                    (click)="sendFieldValue(f)"
                  >Set</button>
                </div>
              </div>
            }
          </div>
        </div>
      }

      <!-- Commands -->
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

  // Settings (writable fields)
  settingsMessage = signal<string | null>(null);
  settingsIsError = signal(false);
  sendingSetting = signal(false);
  private fieldInputs = signal<Record<string, string>>({});

  /** Command name → writable field key mapping (convention-based). */
  private static readonly COMMAND_FIELD_MAP: Record<string, string> = {
    interval: 'tx',
  };

  controls = this.deviceContext.controls;
  loading = this.deviceContext.loading;

  writableFields = computed(() =>
    this.deviceContext.fieldConfigs().filter((f: DeviceField) => f.access === 'w')
  );

  ngOnInit(): void {
    this.api.getFirmwareCommands().subscribe({
      next: (list) => this.firmwareCommands.set(list),
      error: () => this.firmwareCommands.set([]),
    });
  }

  // ─── Settings (writable fields) ─────────────────────────

  currentValue(fieldKey: string): number | null {
    const data = this.deviceContext.latestTelemetry();
    if (!data) return null;
    const v = data[fieldKey];
    return typeof v === 'number' ? v : null;
  }

  getFieldInput(fieldKey: string): string {
    return this.fieldInputs()[fieldKey] ?? '';
  }

  setFieldInput(fieldKey: string, value: string): void {
    this.fieldInputs.update(m => ({ ...m, [fieldKey]: value }));
  }

  /** Find the command name that controls a writable field. */
  private commandForField(fieldKey: string): string | null {
    for (const [cmd, fk] of Object.entries(ControlsPanelComponent.COMMAND_FIELD_MAP)) {
      if (fk === fieldKey) return cmd;
    }
    return null;
  }

  sendFieldValue(field: DeviceField): void {
    const eui = this.eui();
    const command = this.commandForField(field.field_key);
    if (!eui || !command) return;
    const raw = this.fieldInputs()[field.field_key];
    const value = Number(raw);
    if (isNaN(value) || value <= 0) {
      this.settingsIsError.set(true);
      this.settingsMessage.set('Enter a valid value');
      return;
    }
    this.sendingSetting.set(true);
    this.settingsMessage.set(null);
    this.api.sendCommand(eui, command, value).subscribe({
      next: () => {
        this.sendingSetting.set(false);
        this.settingsIsError.set(false);
        this.settingsMessage.set(`${command} command queued (${value})`);
      },
      error: (err) => {
        this.sendingSetting.set(false);
        this.settingsIsError.set(true);
        this.settingsMessage.set(err?.error?.error ?? err?.message ?? 'Failed to send command');
      },
    });
  }

  // ─── Commands ───────────────────────────────────────────

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

  // ─── Controls ───────────────────────────────────────────

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
