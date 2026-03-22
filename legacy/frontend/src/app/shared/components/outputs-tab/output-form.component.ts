import {
  Component, input, output, signal, computed,
  OnChanges, SimpleChanges, OnDestroy, inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import {
  DeviceControl,
  DriverDef,
  isAnalogActuator,
  BoardDefinition,
} from '../../../core/services/api.types';
import { ConfigContextService } from '../../../core/services/config-context.service';
import { PinRequirementsComponent } from '../pin-requirements/pin-requirements.component';

/** Slugify a display name into a valid control key. */
function toControlKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'output';
}

@Component({
  selector: 'app-output-form',
  standalone: true,
  imports: [FormsModule, CommonModule, PinRequirementsComponent],
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

      <!-- Driver selection -->
      <div class="form-control">
        <label class="label text-xs py-0.5">Interface / Driver</label>
        <select class="select select-bordered select-sm w-full max-w-xs"
          [ngModel]="draft.actuator_type" name="driver"
          (ngModelChange)="onDriverChange($event)">
          @for (d of outputDrivers(); track d.id) {
            <option [ngValue]="d.actuator_type">{{ d.label }}</option>
          }
        </select>
        @if (selectedDriver()) {
          <label class="label text-xs py-0.5 text-base-content/50">{{ selectedDriver()!.hint }}</label>
        }
      </div>

      <!-- Pin requirements (GPIO / Bus / Internal) -->
      <app-pin-requirements
        [driver]="selectedDriver()"
        [pinMap]="pinMap()"
        [pinCaps]="ctx.pinCaps()?.pins ?? []"
        [boardDef]="ctx.boardDef()"
        [usedPins]="usedPins()"
        [selectedPins]="draftPins()"
        [busIndex]="draft.bus_index"
        [busAddress]="draft.bus_address ?? 64"
        [busChannel]="draft.bus_channel ?? 0"
        [showBusChannel]="true"
        (pinsChanged)="onPinsChanged($event)"
        (busIndexChanged)="draft.bus_index = $event"
        (busAddressChanged)="draft.bus_address = $event"
        (busChannelChanged)="draft.bus_channel = $event"
      />

      <!-- Pulse duration (solenoid / motorized valve) -->
      @if (selectedDriver()?.has_pulse) {
        <div class="form-control">
          <label class="label text-xs py-0.5">
            Pulse duration
            <span class="label-text-alt text-base-content/40">x100 ms -- how long the pin is energized per command</span>
          </label>
          <input type="number" class="input input-bordered input-sm w-32"
            [(ngModel)]="draft.pulse_x100ms" name="pulse_x100ms" min="1" />
        </div>
      }

      <!-- Analog range (PWM / Servo / DAC) -->
      @if (selectedDriver()?.analog) {
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
  outputDrivers = input<DriverDef[]>([]);

  save = output<Partial<DeviceControl>>();
  cancel = output<void>();

  draft: Partial<DeviceControl> = this.emptyDraft();
  validationError = signal<string | null>(null);

  isEdit = computed(() => !!this.existing()?.id);

  selectedDriver = computed<DriverDef | null>(() => {
    const type = this.draft.actuator_type ?? 0;
    return this.outputDrivers().find(d => d.actuator_type === type) ?? null;
  });

  /** Expose current pin selections as array for PinRequirementsComponent. */
  draftPins = computed(() => {
    const pins: (number | undefined)[] = [];
    if (this.draft.pin_index != null) pins.push(this.draft.pin_index);
    else pins.push(undefined);
    if (this.draft.pin2_index != null && this.draft.pin2_index !== 255) pins.push(this.draft.pin2_index);
    return pins;
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['existing']) {
      const ex = this.existing();
      this.draft = ex ? { ...ex } : this.emptyDraft();
      this.validationError.set(null);
      if (ex?.pin_index != null && ex.pin_index !== 255) {
        this.ctx.setActivePinSelection(ex.pin_index);
      }
    }
  }

  ngOnDestroy(): void {
    this.ctx.setActivePinSelection(null);
  }

  onPinsChanged(pins: (number | undefined)[]): void {
    this.draft = {
      ...this.draft,
      pin_index: pins[0],
      pin2_index: pins.length > 1 ? pins[1] : undefined,
    };
  }

  onNameChange(name: string): void {
    if (!this.isEdit()) {
      this.draft.control_key = toControlKey(name);
    }
  }

  onDriverChange(actuatorType: number): void {
    const driver = this.outputDrivers().find(d => d.actuator_type === actuatorType);
    this.draft.actuator_type = actuatorType;
    this.draft.control_type = driver?.analog ? 'analog' : 'binary';
    this.draft.pin_index = driver?.io_type === 'internal' ? 255 : undefined;
    this.draft.pin2_index = undefined;
    this.draft.bus_index = undefined;
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

    const driver = this.selectedDriver();
    this.save.emit({
      ...this.draft,
      states_json: driver?.analog ? undefined : ['off', 'on'],
    });
  }

  private validate(): string | null {
    const driver = this.selectedDriver();
    if (!this.draft.display_name?.trim()) return 'Name is required.';
    if (driver?.io_type === 'internal') return null; // no pin needed
    if (driver?.bus_addressed) {
      return this.draft.bus_index == null ? 'Select a bus.' : null;
    }
    // Check all required pins are selected
    const requiredCount = driver?.pin_functions?.length ?? 1;
    for (let i = 0; i < requiredCount; i++) {
      const pins = [this.draft.pin_index, this.draft.pin2_index];
      if (pins[i] == null) {
        const label = driver?.pin_labels?.[i] ?? `Pin ${i + 1}`;
        return `Select ${label}.`;
      }
    }
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
      bus_index: undefined,
      bus_address: 0x40,
      bus_channel: 0,
      pulse_x100ms: 10,
    };
  }
}
