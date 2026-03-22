import { Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PIN_FUNCTION, pinFunctionName, type PinFunctionName } from '../../../core/utils/firmware-constraints';

/**
 * DevicePinMapComponent — visual GPIO header diagram.
 *
 * Renders the device's pin_map as two rows of numbered pins (like a 2-row header),
 * color-coded by function and usage:
 *   • Gray    — unused
 *   • Green   — GPIO available
 *   • Blue    — ADC available
 *   • Purple  — I2C available
 *   • Yellow  — Serial available
 *   • Teal    — used by a sensor input
 *   • Amber   — used by a control output
 *
 * Displayed at the top of the Inputs tab so users can see at a glance which
 * pins are occupied before configuring a new sensor.
 */
@Component({
  selector: 'app-device-pin-map',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="rounded-xl border border-base-300 bg-base-200/40 px-4 py-3">
      <p class="text-xs font-semibold text-base-content/40 uppercase tracking-wide mb-3">Pin Map</p>

      <!-- Two-row pin grid (odd row top, even row bottom like a dual-row header) -->
      <div class="flex flex-col gap-1">
        @for (row of rows(); track $index) {
          <div class="flex flex-wrap gap-1">
            @for (pin of row; track pin) {
              <div
                class="w-9 h-9 rounded flex flex-col items-center justify-center text-xs font-mono leading-tight cursor-default select-none"
                [class]="pinClass(pin)"
                [title]="pinTitle(pin)"
              >
                <span class="text-[10px] opacity-70">P{{ pin }}</span>
              </div>
            }
          </div>
        }
      </div>

      <!-- Legend -->
      <div class="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-base-content/60">
        <span class="flex items-center gap-1"><span class="inline-block w-2.5 h-2.5 rounded bg-teal-500/80"></span> Sensor</span>
        <span class="flex items-center gap-1"><span class="inline-block w-2.5 h-2.5 rounded bg-amber-500/80"></span> Output</span>
        <span class="flex items-center gap-1"><span class="inline-block w-2.5 h-2.5 rounded bg-green-600/70"></span> Relay/GPIO</span>
        <span class="flex items-center gap-1"><span class="inline-block w-2.5 h-2.5 rounded bg-blue-500/70"></span> ADC</span>
        <span class="flex items-center gap-1"><span class="inline-block w-2.5 h-2.5 rounded bg-purple-500/70"></span> I2C/1-Wire/UART</span>
        <span class="flex items-center gap-1"><span class="inline-block w-2.5 h-2.5 rounded bg-yellow-500/70"></span> PWM/DAC</span>
        <span class="flex items-center gap-1"><span class="inline-block w-2.5 h-2.5 rounded bg-orange-400/70"></span> Counter</span>
        <span class="flex items-center gap-1"><span class="inline-block w-2.5 h-2.5 rounded bg-base-300"></span> Unused</span>
      </div>
    </div>
  `,
})
export class DevicePinMapComponent {
  /** The device's pin_map array (index = pin number, value = function code). */
  pinMap = input<number[]>([]);
  /** Pin indices used by sensor inputs. */
  usedSensorPins = input<Set<number>>(new Set());
  /** Pin indices used by control outputs. */
  usedControlPins = input<Set<number>>(new Set());

  /** Split pins into two rows of equal length for a dual-row header look. */
  rows = computed<number[][]>(() => {
    const count = this.pinMap().length;
    if (count === 0) return [];
    const half = Math.ceil(count / 2);
    const top = Array.from({ length: half }, (_, i) => i);
    const bot = Array.from({ length: count - half }, (_, i) => i + half);
    return [top, bot];
  });

  pinClass(pin: number): string {
    if (this.usedSensorPins().has(pin)) return 'bg-teal-500/80 text-white';
    if (this.usedControlPins().has(pin)) return 'bg-amber-500/80 text-white';
    const fn: PinFunctionName = pinFunctionName(this.pinMap()[pin] ?? 0);
    switch (fn) {
      case 'relay':   return 'bg-green-600/70 text-white';
      case 'button':  return 'bg-green-600/70 text-white';
      case 'adc':     return 'bg-blue-500/70 text-white';
      case 'i2c':
      case 'onewire':
      case 'uart':    return 'bg-purple-500/70 text-white';
      case 'pwm':
      case 'dac':     return 'bg-yellow-500/70 text-white';
      case 'counter': return 'bg-orange-400/70 text-white';
      default:        return 'bg-base-300 text-base-content/40';
    }
  }

  pinTitle(pin: number): string {
    const fn = pinFunctionName(this.pinMap()[pin] ?? 0);
    if (this.usedSensorPins().has(pin)) return `Pin ${pin}: used by sensor (${fn})`;
    if (this.usedControlPins().has(pin)) return `Pin ${pin}: used by output (${fn})`;
    return `Pin ${pin}: ${fn}`;
  }
}
