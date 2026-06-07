import { Component, input, output, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DriverDef, BoardDefinition, PinInfo } from '../../../core/services/api.types';
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
          <label class="label text-xs py-0.5">Bus</label>
          @if (availableBuses().length > 0) {
            <select class="select select-bordered select-sm w-auto"
              [ngModel]="busIndex()" (ngModelChange)="onBusSelect($event)">
              <option [ngValue]="undefined" disabled>— select bus —</option>
              @for (bus of availableBuses(); track bus.index) {
                <option [ngValue]="bus.index">{{ bus.displayLabel }}</option>
              }
            </select>
          } @else {
            <div class="alert alert-warning py-1 text-xs">
              No {{ driver()!.io_type.toUpperCase() }} bus configured in pin map.
            </div>
          }
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
            [pinCaps]="pinCaps()"
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
  pinCaps = input<PinInfo[]>([]);
  boardDef = input<BoardDefinition | null>(null);
  usedPins = input<Set<number>>(new Set());
  selectedPins = input<(number | undefined)[]>([]);

  busIndex = input<number | undefined>(undefined);
  busAddress = input<number>(0x40);
  busChannel = input<number>(0);
  showBusChannel = input<boolean>(false);

  pinsChanged = output<(number | undefined)[]>();
  busIndexChanged = output<number>();
  busAddressChanged = output<number>();
  busChannelChanged = output<number>();

  /** Available bus instances derived from pinMap, matching the driver's bus_pin_functions. */
  availableBuses = computed<{ index: number; pinIndices: number[]; displayLabel: string }[]>(() => {
    const d = this.driver();
    if (!d?.bus_addressed || !d.bus_pin_functions?.length) return [];
    const map = this.pinMap();
    const board = this.boardDef();
    const busPinFns = d.bus_pin_functions;

    const buses: { index: number; pinIndices: number[]; displayLabel: string }[] = [];
    let busIdx = 0;

    for (let i = 0; i <= map.length - busPinFns.length; i++) {
      if (map[i] !== busPinFns[0]) continue;
      // Check all consecutive pins match the bus pin function pattern
      let match = true;
      for (let j = 1; j < busPinFns.length; j++) {
        if (map[i + j] !== busPinFns[j]) { match = false; break; }
      }
      if (!match) continue;

      const pinIndices = busPinFns.map((_, j) => i + j);
      const pinDescs = busPinFns.map((fn, j) => {
        const fwIdx = i + j;
        const boardPin = board?.pins.find(p => p.firmware_idx === fwIdx);
        const role = pinFunctionName(fn);
        const label = boardPin?.gpio_label ?? `Pin ${fwIdx}`;
        return `${role.toUpperCase()}: ${label}`;
      });
      buses.push({
        index: busIdx,
        pinIndices,
        displayLabel: `Bus ${busIdx} — ${pinDescs.join(', ')}`,
      });
      busIdx++;
      i += busPinFns.length - 1; // skip past this group
    }
    return buses;
  });

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

  onBusSelect(busIndex: number): void {
    this.busIndexChanged.emit(busIndex);
    const bus = this.availableBuses().find(b => b.index === busIndex);
    if (bus) {
      this.ctx.setActivePinSelection(bus.pinIndices);
    }
  }
  onBusIndexChange(val: number): void { this.busIndexChanged.emit(val); }
  onBusAddressChange(val: number): void { this.busAddressChanged.emit(val); }
  onBusChannelChange(val: number): void { this.busChannelChanged.emit(val); }
}
