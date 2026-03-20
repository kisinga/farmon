import {
  Component, input, output, signal, computed,
  OnChanges, SimpleChanges, OnDestroy, inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import {
  DeviceControl,
  OutputInterfaceInfo,
  isAnalogActuator,
} from '../../../core/services/api.types';
import { ConfigContextService } from '../../../core/services/config-context.service';
import { PinFunctionName } from '../../../core/utils/firmware-constraints';
import { PinDropdownComponent } from '../pin-dropdown/pin-dropdown.component';

/** Slugify a display name into a valid control key. */
function toControlKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'output';
}

@Component({
  selector: 'app-output-form',
  standalone: true,
  imports: [FormsModule, CommonModule, PinDropdownComponent],
  template: `
    <form (ngSubmit)="onSubmit()" class="space-y-5">

      <!-- Name -->
      <div class="form-control">
        <label class="label text-xs py-0.5">Name</label>
        <input type="text" class="input input-bordered input-sm"
          [(ngModel)]="draft.display_name" name="display_name"
          placeholder="e.g. Pump 1"
          (ngModelChange)="onNameChange($event)" />
      </div>

      <!-- Interface / Driver -->
      <div class="form-control">
        <label class="label text-xs py-0.5">Interface / Driver</label>
        <select class="select select-bordered select-sm w-full max-w-xs"
          [(ngModel)]="draft.actuator_type" name="actuator_type"
          (ngModelChange)="onInterfaceChange($event)">
          @for (iface of outputInterfaces(); track iface.id) {
            <option [ngValue]="iface.actuator_type">{{ iface.label }}</option>
          }
        </select>
        @if (selectedInterface()) {
          <label class="label text-xs py-0.5 text-base-content/50">{{ selectedInterface()!.hint }}</label>
        }
      </div>

      <!-- GPIO Pin (non-bus actuators) -->
      @if (!selectedInterface()?.bus_addressed) {
        <div class="form-control">
          <label class="label text-xs py-0.5">GPIO Pin</label>
          <app-pin-dropdown
            [selectedPin]="draft.pin_index"
            [capability]="requiredCapability()"
            [usedPins]="usedPins()"
            [excludePins]="secondaryPinExclude()"
            [pinMap]="pinMap()"
            (pinSelected)="onPrimaryPinChange($event)"
          />
        </div>

        <!-- Second GPIO pin (motorized valve: open/close direction) -->
        @if (selectedInterface()?.dual_pin) {
          <div class="form-control">
            <label class="label text-xs py-0.5">
              Direction Pin <span class="text-base-content/40">(close signal)</span>
            </label>
            <app-pin-dropdown
              [selectedPin]="draft.pin2_index"
              capability="relay"
              [usedPins]="usedPins()"
              [excludePins]="primaryPinExclude()"
              [pinMap]="pinMap()"
              (pinSelected)="onSecondaryPinChange($event)"
            />
          </div>
        }
      }

      <!-- Bus actuator (I2C PWM) -->
      @if (selectedInterface()?.bus_addressed) {
        <div class="flex flex-wrap gap-4">
          <div class="form-control">
            <label class="label text-xs py-0.5">Bus index</label>
            <input type="number" class="input input-bordered input-sm w-24"
              [(ngModel)]="draft.bus_index" name="bus_index" min="0" max="3" />
          </div>
          <div class="form-control">
            <label class="label text-xs py-0.5">I2C address (hex)</label>
            <input type="number" class="input input-bordered input-sm w-28"
              [(ngModel)]="draft.bus_address" name="bus_address" min="0" max="127" />
          </div>
          <div class="form-control">
            <label class="label text-xs py-0.5">Channel</label>
            <input type="number" class="input input-bordered input-sm w-20"
              [(ngModel)]="draft.bus_channel" name="bus_channel" min="0" max="15" />
          </div>
        </div>
      }

      <!-- Pulse duration (solenoid / motorized valve) -->
      @if (selectedInterface()?.has_pulse) {
        <div class="form-control">
          <label class="label text-xs py-0.5">
            Pulse duration
            <span class="label-text-alt text-base-content/40">×100 ms — how long the pin is energized per command</span>
          </label>
          <input type="number" class="input input-bordered input-sm w-32"
            [(ngModel)]="draft.pulse_x100ms" name="pulse_x100ms" min="1" />
        </div>
      }

      <!-- Analog range (PWM / Servo / DAC) -->
      @if (selectedInterface()?.analog) {
        <div class="flex flex-wrap gap-4">
          <div class="form-control">
            <label class="label text-xs py-0.5">Min value</label>
            <input type="number" class="input input-bordered input-sm w-24"
              [(ngModel)]="draft.min_value" name="min_value" step="any" />
          </div>
          <div class="form-control">
            <label class="label text-xs py-0.5">Max value</label>
            <input type="number" class="input input-bordered input-sm w-24"
              [(ngModel)]="draft.max_value" name="max_value" step="any" />
          </div>
        </div>
      }

      <!-- Validation error -->
      @if (validationError()) {
        <div class="alert alert-error text-xs py-2">{{ validationError() }}</div>
      }

      <!-- Actions -->
      <div class="flex gap-2 pt-1">
        <button type="submit" class="btn btn-sm btn-primary">
          {{ isEdit() ? 'Update' : 'Add output' }}
        </button>
        <button type="button" class="btn btn-sm btn-ghost" (click)="onCancel()">Cancel</button>
      </div>

    </form>
  `,
})
export class OutputFormComponent implements OnChanges, OnDestroy {
  protected ctx = inject(ConfigContextService);

  existing = input<DeviceControl | undefined>(undefined);
  pinMap = input<number[]>([]);
  usedPins = input<Set<number>>(new Set());
  outputInterfaces = input<OutputInterfaceInfo[]>([]);

  save = output<Partial<DeviceControl>>();
  cancel = output<void>();

  draft: Partial<DeviceControl> = this.emptyDraft();
  validationError = signal<string | null>(null);

  isEdit = computed(() => !!this.existing()?.id);

  selectedInterface = computed<OutputInterfaceInfo | null>(() => {
    const type = this.draft.actuator_type ?? 0;
    return this.outputInterfaces().find(i => i.actuator_type === type) ?? null;
  });

  requiredCapability = computed<PinFunctionName>(() => {
    switch (this.draft.actuator_type ?? 0) {
      case 3:
      case 4:  return 'pwm';
      case 5:  return 'dac';
      default: return 'relay';
    }
  });

  secondaryPinExclude = computed(() =>
    this.draft.pin2_index != null ? [this.draft.pin2_index] : []
  );

  primaryPinExclude = computed(() =>
    this.draft.pin_index != null ? [this.draft.pin_index] : []
  );

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['existing']) {
      const ex = this.existing();
      this.draft = ex ? { ...ex } : this.emptyDraft();
      this.validationError.set(null);
      if (ex?.pin_index != null) {
        this.ctx.setActivePinSelection(ex.pin_index);
      }
    }
  }

  ngOnDestroy(): void {
    this.ctx.setActivePinSelection(null);
  }

  onPrimaryPinChange(pin: number): void {
    this.draft = { ...this.draft, pin_index: pin };
    this.ctx.setActivePinSelection(pin);
  }

  onSecondaryPinChange(pin: number): void {
    this.draft = { ...this.draft, pin2_index: pin };
  }

  onNameChange(name: string): void {
    if (!this.isEdit()) {
      this.draft.control_key = toControlKey(name);
    }
  }

  onInterfaceChange(actuatorType: number): void {
    this.draft.actuator_type = actuatorType;
    this.draft.control_type = isAnalogActuator(actuatorType) ? 'analog' : 'binary';
    this.draft.pin_index = undefined;
    this.draft.pin2_index = undefined;
    this.ctx.setActivePinSelection(null);
  }

  onCancel(): void {
    this.ctx.setActivePinSelection(null);
    this.cancel.emit();
  }

  onSubmit(): void {
    const err = this.validate();
    if (err) { this.validationError.set(err); return; }
    this.validationError.set(null);
    this.ctx.setActivePinSelection(null);

    const iface = this.selectedInterface();
    this.save.emit({
      ...this.draft,
      states_json: iface?.analog ? undefined : ['off', 'on'],
    });
  }

  private validate(): string | null {
    const iface = this.selectedInterface();
    if (!this.draft.display_name?.trim()) return 'Name is required.';
    if (!iface?.bus_addressed && this.draft.pin_index == null) return 'Select a GPIO pin.';
    if (iface?.dual_pin && this.draft.pin2_index == null) return 'Select the direction pin.';
    return null;
  }

  private emptyDraft(): Partial<DeviceControl> {
    return {
      control_key: '',
      display_name: '',
      actuator_type: 0,
      control_type: 'binary',
      pin_index: undefined,
      pin2_index: undefined,
      min_value: 0,
      max_value: 100,
      bus_index: 0,
      bus_address: 0x40,
      bus_channel: 0,
      pulse_x100ms: 10,
    };
  }
}
