import { Component, inject, computed, signal } from '@angular/core';
import { ApiService, DeviceCommand, DeviceField } from '../../../core/services/api.service';
import { DeviceContextService } from '../../../core/services/device-context.service';

@Component({
  selector: 'app-device-config-panel',
  standalone: true,
  template: `
    <div class="space-y-4">
      <h2 class="section-title">Configuration</h2>
      @if (message()) {
        <div class="alert text-sm rounded-xl" [class.alert-error]="isError()" [class.alert-success]="!isError()">
          <span>{{ message() }}</span>
        </div>
      }

      @if (writableFields().length > 0) {
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
                  [disabled]="sending()"
                  (click)="sendFieldValue(f)"
                >Set</button>
              </div>
            </div>
          }
        </div>
      }

      @if (actionCommands().length > 0) {
        <div class="space-y-3">
          <h3 class="text-sm font-medium text-base-content/70">Commands</h3>
          <div class="flex flex-wrap gap-2">
            @for (cmd of actionCommands(); track cmd.name) {
              <button
                type="button"
                class="btn btn-sm btn-outline capitalize"
                [disabled]="sending()"
                (click)="sendAction(cmd.name)"
              >{{ cmd.name }}</button>
            }
          </div>
        </div>
      }

      @if (writableFields().length === 0 && actionCommands().length === 0) {
        <p class="text-base-content/60 text-sm">No configurable fields or commands available for this profile.</p>
      }
    </div>
  `,
})
export class DeviceConfigPanelComponent {
  private api = inject(ApiService);
  private deviceContext = inject(DeviceContextService);

  message = signal<string | null>(null);
  isError = signal(false);
  sending = signal(false);
  private fieldInputs = signal<Record<string, string>>({});

  /** Command name → writable field key mapping (convention-based). */
  private static readonly COMMAND_FIELD_MAP: Record<string, string> = {
    interval: 'tx',
  };

  writableFields = computed(() =>
    this.deviceContext.fieldConfigs().filter(f => f.access === 'w')
  );

  /** Commands from the device (device_commands collection). Action commands = those that don't map to a writable field. */
  actionCommands = computed<DeviceCommand[]>(() => {
    const commands = this.deviceContext.deviceCommands();
    const fieldCommands = new Set(Object.keys(DeviceConfigPanelComponent.COMMAND_FIELD_MAP));
    return commands.filter(c => !fieldCommands.has(c.name));
  });

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
    for (const [cmd, fk] of Object.entries(DeviceConfigPanelComponent.COMMAND_FIELD_MAP)) {
      if (fk === fieldKey) return cmd;
    }
    return null;
  }

  sendFieldValue(field: DeviceField): void {
    const eui = this.deviceContext.eui();
    const command = this.commandForField(field.field_key);
    if (!eui || !command) return;
    const raw = this.fieldInputs()[field.field_key];
    const value = Number(raw);
    if (isNaN(value) || value <= 0) {
      this.isError.set(true);
      this.message.set('Enter a valid value');
      return;
    }
    this.sending.set(true);
    this.message.set(null);
    this.api.sendCommand(eui, command, value).subscribe({
      next: () => {
        this.sending.set(false);
        this.isError.set(false);
        this.message.set(`${command} command queued (${value})`);
      },
      error: (err) => {
        this.sending.set(false);
        this.isError.set(true);
        this.message.set(err?.error?.error ?? err?.message ?? 'Failed to send command');
      },
    });
  }

  sendAction(command: string): void {
    const eui = this.deviceContext.eui();
    if (!eui) return;
    this.sending.set(true);
    this.message.set(null);
    this.api.sendCommand(eui, command).subscribe({
      next: () => {
        this.sending.set(false);
        this.isError.set(false);
        this.message.set(`${command} command queued`);
      },
      error: (err) => {
        this.sending.set(false);
        this.isError.set(true);
        this.message.set(err?.error?.error ?? err?.message ?? 'Failed to send command');
      },
    });
  }
}
