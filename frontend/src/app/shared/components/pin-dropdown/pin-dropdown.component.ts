import { Component, input, output, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfigContextService } from '../../../core/services/config-context.service';
import { pinFunctionName, PinFunctionName, MAX_PIN_INDEX } from '../../../core/utils/firmware-constraints';
import { BOARD_DEFINITIONS } from '../../../core/constants/board-definitions';

/**
 * Shared GPIO pin dropdown used by both Input and Output forms.
 *
 * Filters pins by required capability and excludes any already-used pins.
 * Updates ConfigContextService.activePinSelection so the board SVG highlights
 * the currently selected pin.
 */
@Component({
  selector: 'app-pin-dropdown',
  standalone: true,
  imports: [FormsModule],
  template: `
    <select class="select select-bordered select-sm w-full max-w-xs"
      [ngModel]="selectedPin()"
      (ngModelChange)="onSelect($event)">
      <option [ngValue]="undefined" disabled>— select pin —</option>
      @for (pin of availablePins(); track pin.index) {
        <option [ngValue]="pin.index">Pin {{ pin.index }} — {{ pin.label }}</option>
      }
    </select>
  `,
})
export class PinDropdownComponent {
  private ctx = inject(ConfigContextService);

  /** Currently selected pin (undefined = none). */
  selectedPin = input<number | undefined>(undefined);
  /** Pin capability required (e.g. 'relay', 'adc', 'pwm'). */
  capability = input.required<PinFunctionName>();
  /** Pins already used by other sensors/outputs (excludes current item's own pin). */
  usedPins = input<Set<number>>(new Set());
  /** Extra pins to exclude (e.g. the other pin in a dual-pin output). */
  excludePins = input<number[]>([]);
  /** Device pin_map array. When available, filters by capability. */
  pinMap = input<number[]>([]);

  pinSelected = output<number>();

  availablePins = computed(() => {
    const map = this.pinMap();
    const used = this.usedPins();
    const required = this.capability();
    const excluded = new Set(this.excludePins());
    const model = this.ctx.device()?.hardware_model;
    const boardDef = model ? BOARD_DEFINITIONS[model] : undefined;

    if (map.length > 0) {
      // AirConfig mode: filter by capability
      return map
        .map((code, i) => {
          const boardPin = boardDef?.pins.find(p => p.firmwarePin === i);
          return {
            index: i,
            capName: pinFunctionName(code),
            label: boardPin?.label ?? `Pin ${i} (${pinFunctionName(code)})`,
          };
        })
        .filter(p => p.capName === required && !used.has(p.index) && !excluded.has(p.index));
    }

    // No pinMap: show all board pins (or generic 0-19), exclude only used pins
    if (boardDef) {
      return boardDef.pins
        .filter(p => !used.has(p.firmwarePin) && !excluded.has(p.firmwarePin))
        .map(p => ({ index: p.firmwarePin, capName: 'unused' as PinFunctionName, label: p.label }));
    }

    // Last resort: generic 0-19
    return Array.from({ length: MAX_PIN_INDEX + 1 }, (_, i) => ({
      index: i,
      capName: 'unused' as PinFunctionName,
      label: `Pin ${i}`,
    })).filter(p => !used.has(p.index) && !excluded.has(p.index));
  });

  onSelect(pin: number): void {
    this.ctx.setActivePinSelection(pin);
    this.pinSelected.emit(pin);
  }
}
