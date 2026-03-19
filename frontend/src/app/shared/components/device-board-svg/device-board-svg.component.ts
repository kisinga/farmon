import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConfigContextService } from '../../../core/services/config-context.service';
import { PinFunctionName, pinFunctionName } from '../../../core/utils/firmware-constraints';

interface LegendItem { fns: PinFunctionName[]; label: string; hex: string; }

const FUNCTION_LEGEND: LegendItem[] = [
  { fns: ['relay', 'button'], label: 'Relay/GPIO', hex: '#16a34a' },
  { fns: ['adc'],             label: 'ADC',        hex: '#3b82f6' },
  { fns: ['i2c', 'onewire', 'uart'], label: 'I2C/UART', hex: '#a855f7' },
  { fns: ['pwm', 'dac'],      label: 'PWM/DAC',   hex: '#eab308' },
  { fns: ['counter'],         label: 'Counter',    hex: '#fb923c' },
];

/**
 * DeviceBoardSvgComponent — persistent ESP32-style board diagram shown above all config tabs.
 *
 * Renders 20 GPIO pins (0-9 left rail, 10-19 right rail) as an inline SVG that mirrors
 * the physical dual-row header layout of a DevKit board.
 *
 * Pin color priority (highest wins):
 *  1. Sensor used    → teal
 *  2. Control used   → amber
 *  3. Picker active + selectable → pulsing blue
 *  4. Picker active + excluded/incompatible → dark gray
 *  5. Free by function → green/blue/purple/orange/yellow/gray
 *
 * When isPinPickerActive(), compatible non-excluded pins are clickable and
 * animate with a pulse. Clicking calls ctx.onBoardPinClicked(pin).
 */
@Component({
  selector: 'app-device-board-svg',
  standalone: true,
  imports: [CommonModule],
  styles: [`
    @keyframes picker-pulse {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.55; }
    }
    .pin-selectable { animation: picker-pulse 1.1s ease-in-out infinite; }
  `],
  template: `
    <div class="rounded-xl border border-base-300 bg-base-200/40 px-4 py-3">
      <p class="text-xs font-semibold text-base-content/40 uppercase tracking-wide mb-3">
        Board — GPIO Map
        @if (ctx.isPinPickerActive()) {
          <span class="ml-2 text-blue-400 normal-case font-normal animate-pulse">
            ↑ Click a highlighted pin to assign
          </span>
        }
      </p>

      <div class="flex justify-center overflow-x-auto">
        <svg
          viewBox="0 0 320 310"
          class="w-full max-w-lg"
          aria-label="ESP32 board pin map"
        >
          <!-- ── Board PCB outline ── -->
          <rect x="88" y="10" width="144" height="280" rx="6"
            fill="#1c2432" stroke="#374151" stroke-width="1.5"/>

          <!-- Board mounting holes (decorative) -->
          <circle cx="100" cy="22" r="4" fill="#111827"/>
          <circle cx="220" cy="22" r="4" fill="#111827"/>
          <circle cx="100" cy="278" r="4" fill="#111827"/>
          <circle cx="220" cy="278" r="4" fill="#111827"/>

          <!-- ESP32 module (inner chip block) -->
          <rect x="111" y="70" width="98" height="130" rx="3"
            fill="#111827" stroke="#4b5563" stroke-width="1"/>
          <rect x="116" y="75" width="88" height="120" rx="2"
            fill="#0f172a" stroke="#1e3a5f" stroke-width="0.8"/>
          <!-- Chip label -->
          <text x="160" y="132" text-anchor="middle" font-size="11"
            fill="#60a5fa" font-family="monospace" font-weight="bold">{{ chipLabel() }}</text>
          <text x="160" y="147" text-anchor="middle" font-size="7"
            fill="#374151" font-family="monospace">{{ chipSubLabel() }}</text>

          <!-- Antenna notch top right -->
          <rect x="188" y="10" width="44" height="28" rx="3"
            fill="#111827" stroke="#374151" stroke-width="1"/>
          <text x="210" y="28" text-anchor="middle" font-size="7"
            fill="#6b7280" font-family="monospace">ANT</text>

          <!-- USB connector at bottom -->
          <rect x="132" y="284" width="56" height="18" rx="3"
            fill="#1f2937" stroke="#4b5563" stroke-width="1"/>
          <text x="160" y="296" text-anchor="middle" font-size="7"
            fill="#6b7280" font-family="monospace">USB</text>

          <!-- ── Left rail pins 0-9 ── -->
          @for (i of leftPins; track i) {
            <g
              [class.pin-selectable]="isPinSelectable(i)"
              [style.cursor]="isPinSelectable(i) ? 'pointer' : 'default'"
              (click)="onPinClick(i)"
            >
              <!-- stub line to board -->
              <line [attr.x1]="51" [attr.x2]="88"
                    [attr.y1]="pinY(i)" [attr.y2]="pinY(i)"
                    stroke="#4b5563" stroke-width="1.5"/>
              <!-- pin circle -->
              <circle
                [attr.cx]="40"
                [attr.cy]="pinY(i)"
                r="13"
                [attr.fill]="pinFill(i)"
                [attr.stroke]="pinStroke(i)"
                [attr.stroke-width]="pinStrokeWidth(i)"
              />
              <!-- pin number -->
              <text
                [attr.x]="40"
                [attr.y]="pinY(i) + 4"
                text-anchor="middle"
                font-size="8"
                font-family="monospace"
                font-weight="bold"
                fill="white"
              >{{ i }}</text>
              <!-- connected dot -->
              @if (isUsed(i)) {
                <circle [attr.cx]="40" [attr.cy]="pinY(i) - 8" r="3" fill="white" opacity="0.9"/>
              }
            </g>
          }

          <!-- ── Right rail pins 10-19 ── -->
          @for (i of rightPins; track i) {
            <g
              [class.pin-selectable]="isPinSelectable(i)"
              [style.cursor]="isPinSelectable(i) ? 'pointer' : 'default'"
              (click)="onPinClick(i)"
            >
              <!-- stub line to board -->
              <line [attr.x1]="232" [attr.x2]="269"
                    [attr.y1]="pinY(i)" [attr.y2]="pinY(i)"
                    stroke="#4b5563" stroke-width="1.5"/>
              <!-- pin circle -->
              <circle
                [attr.cx]="280"
                [attr.cy]="pinY(i)"
                r="13"
                [attr.fill]="pinFill(i)"
                [attr.stroke]="pinStroke(i)"
                [attr.stroke-width]="pinStrokeWidth(i)"
              />
              <!-- pin number -->
              <text
                [attr.x]="280"
                [attr.y]="pinY(i) + 4"
                text-anchor="middle"
                font-size="8"
                font-family="monospace"
                font-weight="bold"
                fill="white"
              >{{ i }}</text>
              <!-- connected dot -->
              @if (isUsed(i)) {
                <circle [attr.cx]="280" [attr.cy]="pinY(i) - 8" r="3" fill="white" opacity="0.9"/>
              }
            </g>
          }
        </svg>
      </div>

      <!-- Legend -->
      <div class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-base-content/60">
        <span class="flex items-center gap-1"><span class="inline-block w-2.5 h-2.5 rounded-full bg-teal-500/80"></span> Sensor</span>
        <span class="flex items-center gap-1"><span class="inline-block w-2.5 h-2.5 rounded-full bg-amber-500/80"></span> Output</span>
        @for (item of legendItems(); track item.label) {
          <span class="flex items-center gap-1">
            <span class="inline-block w-2.5 h-2.5 rounded-full" [style.backgroundColor]="item.hex" style="opacity:0.8"></span>
            {{ item.label }}
          </span>
        }
        <span class="flex items-center gap-1"><span class="inline-block w-2.5 h-2.5 rounded-full bg-gray-500/70"></span> Unused</span>
      </div>
    </div>
  `,
})
export class DeviceBoardSvgComponent {
  protected ctx = inject(ConfigContextService);

  readonly leftPins  = Array.from({ length: 10 }, (_, i) => i);       // 0-9
  readonly rightPins = Array.from({ length: 10 }, (_, i) => i + 10);  // 10-19

  chipLabel = computed(() => {
    const mcu = this.ctx.pinCaps()?.mcu;
    if (mcu === 'rp2040') return 'RP2040';
    if (mcu === 'lorae5' || mcu === 'stm32wl') return 'STM32WL';
    return this.ctx.device()?.hardware_model?.toUpperCase() ?? 'MCU';
  });

  chipSubLabel = computed(() => {
    const mcu = this.ctx.pinCaps()?.mcu;
    if (mcu === 'rp2040') return 'Pico W';
    if (mcu === 'lorae5' || mcu === 'stm32wl') return 'LoRa-E5';
    return '';
  });

  legendItems = computed(() => {
    const fnSet = new Set<PinFunctionName>();
    const caps = this.ctx.pinCaps();
    if (caps) {
      for (const p of caps.pins) {
        for (const fn of p.functions) fnSet.add(pinFunctionName(fn));
      }
    } else {
      for (const code of this.ctx.pinMapArray()) {
        if (code !== 0) fnSet.add(pinFunctionName(code));
      }
    }
    return FUNCTION_LEGEND.filter(item => item.fns.some(fn => fnSet.has(fn)));
  });

  /**
   * Y coordinate for pin i.
   * Both rails use the same vertical spacing: index within the 0-9 or 10-19 group.
   */
  pinY(pin: number): number {
    const idx = pin < 10 ? pin : pin - 10;
    return 28 + idx * 26;
  }

  isUsed(pin: number): boolean {
    return this.ctx.usedSensorPins().has(pin) || this.ctx.usedControlPins().has(pin);
  }

  private fnColor(pin: number): string {
    const fn: PinFunctionName = pinFunctionName(this.ctx.pinMapArray()[pin] ?? 0);
    switch (fn) {
      case 'relay':
      case 'button':  return '#16a34a';  // green-600
      case 'adc':     return '#3b82f6';  // blue-500
      case 'i2c':
      case 'onewire':
      case 'uart':    return '#a855f7';  // purple-500
      case 'counter': return '#fb923c';  // orange-400
      case 'pwm':
      case 'dac':     return '#eab308';  // yellow-500
      default:        return '#4b5563';  // gray-600
    }
  }

  /** True if the hardware supports the given capability on this pin. Falls back to pinMapArray. */
  private pinSupportsCapability(pin: number, capability: PinFunctionName): boolean {
    const caps = this.ctx.pinCaps();
    if (caps) {
      const pinInfo = caps.pins.find(p => p.pin === pin);
      if (!pinInfo) return false;
      return pinInfo.functions.some(fn => pinFunctionName(fn) === capability);
    }
    return pinFunctionName(this.ctx.pinMapArray()[pin] ?? 0) === capability;
  }

  pinFill(pin: number): string {
    // 1. used by sensor
    if (this.ctx.usedSensorPins().has(pin)) return '#14b8a6';   // teal-500
    // 2. used by control
    if (this.ctx.usedControlPins().has(pin)) return '#f59e0b';  // amber-500

    const mode = this.ctx.pinPickerMode();
    if (mode) {
      const excluded = mode.excludedPins.has(pin);
      const compatible = this.pinSupportsCapability(pin, mode.capability);
      if (compatible && !excluded) return '#2563eb';  // blue-600 (selectable)
      return '#1f2937';  // almost-black (incompatible/excluded in picker mode)
    }

    return this.fnColor(pin);
  }

  isPinSelectable(pin: number): boolean {
    const mode = this.ctx.pinPickerMode();
    if (!mode) return false;
    if (mode.excludedPins.has(pin)) return false;
    if (this.ctx.usedSensorPins().has(pin) || this.ctx.usedControlPins().has(pin)) return false;
    return this.pinSupportsCapability(pin, mode.capability);
  }

  pinStroke(pin: number): string {
    const mode = this.ctx.pinPickerMode();
    if (mode && this.isPinSelectable(pin)) return '#93c5fd';   // blue-300 ring
    if (this.isUsed(pin)) return 'rgba(255,255,255,0.25)';
    return 'transparent';
  }

  pinStrokeWidth(pin: number): number {
    if (this.ctx.pinPickerMode() && this.isPinSelectable(pin)) return 2.5;
    if (this.isUsed(pin)) return 1.5;
    return 0;
  }

  onPinClick(pin: number): void {
    if (this.isPinSelectable(pin)) {
      this.ctx.onBoardPinClicked(pin);
    }
  }
}
