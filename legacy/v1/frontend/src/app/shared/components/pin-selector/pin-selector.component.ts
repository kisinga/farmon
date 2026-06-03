import { Component, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PinFunctionName, pinFunctionName } from '../../../core/utils/firmware-constraints';
import { PinInfo } from '../../../core/services/api.types';

/**
 * PinSelectorComponent — pin picker that respects pin_map capability constraints.
 *
 * Shows pins color-coded: available (green), incompatible (gray), already used (amber).
 * Used in OutputFormComponent and DeviceSensorConfigComponent.
 */
@Component({
  selector: 'app-pin-selector',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="flex flex-wrap gap-1">
      @for (pin of pins(); track pin) {
        <button
          type="button"
          class="btn btn-xs"
          [class]="pinClass(pin)"
          [disabled]="!canSelect(pin)"
          (click)="onSelect(pin)"
          [title]="pinTitle(pin)"
        >
          P{{ pin }}
        </button>
      }
    </div>
    @if (selectedPin() != null) {
      <p class="text-xs text-base-content/60 mt-1">Selected: Pin {{ selectedPin() }}</p>
    }
  `,
})
export class PinSelectorComponent {
  /** The device's pin_map array (index = pin number, value = function code). */
  pinMap = input<number[]>([]);
  /** Per-pin hardware capability table from the backend pincaps endpoint. When provided,
   *  capability checks use hardware data rather than the current config pinMap. */
  pinCaps = input<PinInfo[]>([]);
  /** Set of pins currently occupied by OTHER inputs/outputs (excluding the current item). */
  usedPins = input<Set<number>>(new Set());
  /** The capability this pin must support. */
  requiredCapability = input<PinFunctionName>('relay');
  /** Currently selected pin (undefined = none). */
  selectedPin = input<number | undefined>(undefined);

  pinSelected = output<number>();

  pins = computed(() => Array.from({ length: this.pinMap().length }, (_, i) => i));

  supportsCapability(pin: number): boolean {
    const cap = this.requiredCapability();
    const caps = this.pinCaps();
    if (caps.length > 0) {
      const pinInfo = caps.find(p => p.pin === pin);
      if (!pinInfo) return false;
      return pinInfo.functions.some(fn => pinFunctionName(fn) === cap);
    }
    // Fallback: use pinMap (current config assignment)
    const code = this.pinMap()[pin] ?? 0;
    if (cap === 'unused') return code === 0;
    return pinFunctionName(code) === cap;
  }

  canSelect(pin: number): boolean {
    return this.supportsCapability(pin) && !this.usedPins().has(pin);
  }

  pinClass(pin: number): string {
    if (this.selectedPin() === pin) return 'btn-primary';
    if (!this.supportsCapability(pin)) return 'btn-ghost opacity-30';
    if (this.usedPins().has(pin)) return 'btn-warning btn-outline';
    return 'btn-outline';
  }

  pinTitle(pin: number): string {
    const code = this.pinMap()[pin] ?? 0;
    const fn = pinFunctionName(code);
    if (!this.supportsCapability(pin)) return `Pin ${pin}: ${fn} (incompatible — need ${this.requiredCapability()})`;
    if (this.usedPins().has(pin)) return `Pin ${pin}: in use`;
    return `Pin ${pin}: ${fn}`;
  }

  onSelect(pin: number): void {
    if (this.canSelect(pin)) this.pinSelected.emit(pin);
  }
}
