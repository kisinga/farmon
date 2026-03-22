import { Component, input, output, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DriverDef, BoardDefinition } from '../../../core/services/api.types';
import { pinFunctionName, PinFunctionName } from '../../../core/utils/firmware-constraints';
import { ConfigContextService } from '../../../core/services/config-context.service';
import { PinDropdownComponent } from '../pin-dropdown/pin-dropdown.component';

/**
 * Composable multi-pin selector driven by a DriverDef's pin_functions[] and pin_labels[].
 *
 * Renders N labeled pin dropdowns (one per required pin), a bus selector for bus-addressed
 * drivers, or an info badge for internal drivers (no pin selection needed).
 */
@Component({
  selector: 'app-pin-requirements',
  standalone: true,
  imports: [FormsModule, PinDropdownComponent],
  template: `
    <!-- Internal driver: no pin selection -->
    @if (driver()?.io_type === 'internal') {
      <div class="alert alert-info py-2 text-xs">
        {{ driver()!.hint || 'Uses onboard hardware — no pin selection needed.' }}
      </div>
    }

    <!-- Bus-addressed driver: bus instance + address -->
    @else if (driver()?.bus_addressed) {
      <div class="flex flex-wrap gap-4">
        <div class="form-control">
          <label class="label text-xs py-0.5">Bus index</label>
          <input type="number" class="input input-bordered input-sm w-24"
            [ngModel]="busIndex()" (ngModelChange)="onBusIndexChange($event)"
            min="0" max="3" />
        </div>
        <div class="form-control">
          <label class="label text-xs py-0.5">I2C address (hex)</label>
          <input type="number" class="input input-bordered input-sm w-28"
            [ngModel]="busAddress()" (ngModelChange)="onBusAddressChange($event)"
            min="0" max="127" />
        </div>
        @if (showBusChannel()) {
          <div class="form-control">
            <label class="label text-xs py-0.5">Channel</label>
            <input type="number" class="input input-bordered input-sm w-20"
              [ngModel]="busChannel()" (ngModelChange)="onBusChannelChange($event)"
              min="0" max="15" />
          </div>
        }
      </div>
    }

    <!-- GPIO pin selection: one dropdown per required pin -->
    @else {
      @for (req of pinRequirements(); track $index) {
        <div class="form-control">
          <label class="label text-xs py-0.5">{{ req.label }}</label>
          <app-pin-dropdown
            [selectedPin]="selectedPins()[$index]"
            [capability]="req.capability"
            [usedPins]="usedPins()"
            [excludePins]="excludeForIndex($index)"
            [pinMap]="pinMap()"
            (pinSelected)="onPinChange($index, $event)"
          />
        </div>
      }
    }
  `,
})
export class PinRequirementsComponent {
  private ctx = inject(ConfigContextService);

  driver = input<DriverDef | null>(null);
  pinMap = input<number[]>([]);
  usedPins = input<Set<number>>(new Set());
  selectedPins = input<(number | undefined)[]>([]);

  busIndex = input<number>(0);
  busAddress = input<number>(0x40);
  busChannel = input<number>(0);
  showBusChannel = input<boolean>(false);

  pinsChanged = output<(number | undefined)[]>();
  busIndexChanged = output<number>();
  busAddressChanged = output<number>();
  busChannelChanged = output<number>();

  pinRequirements = computed(() => {
    const d = this.driver();
    if (!d || d.io_type === 'internal' || d.bus_addressed) return [];
    const fns = d.pin_functions ?? [];
    const labels = d.pin_labels ?? [];
    return fns.map((fn, i) => ({
      capability: pinFunctionName(fn) as PinFunctionName,
      label: labels[i] ?? `Pin ${i + 1}`,
    }));
  });

  excludeForIndex(index: number): number[] {
    const pins = this.selectedPins();
    return pins
      .filter((p, i) => i !== index && p != null)
      .map(p => p!);
  }

  onPinChange(index: number, pin: number): void {
    const current = [...this.selectedPins()];
    while (current.length <= index) current.push(undefined);
    current[index] = pin;
    this.pinsChanged.emit(current);
    if (index === 0) {
      this.ctx.setActivePinSelection(pin);
    }
  }

  onBusIndexChange(val: number): void { this.busIndexChanged.emit(val); }
  onBusAddressChange(val: number): void { this.busAddressChanged.emit(val); }
  onBusChannelChange(val: number): void { this.busChannelChanged.emit(val); }
}
