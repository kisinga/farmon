import {
  Component, computed, inject, signal, effect,
  ElementRef, ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ConfigContextService } from '../../../core/services/config-context.service';
import { BoardPinDef } from '../../../core/services/api.types';
import { pinFunctionName, PinFunctionName } from '../../../core/utils/firmware-constraints';
import { PinOverlayComponent } from './pin-overlay.component';
import { PinOverlayItem } from './pin-overlay.types';

const FN_COLORS: Record<PinFunctionName, string> = {
  relay:   '#16a34a',
  button:  '#16a34a',
  adc:     '#3b82f6',
  i2c:     '#a855f7',
  onewire: '#a855f7',
  uart:    '#a855f7',
  counter: '#fb923c',
  pwm:     '#eab308',
  dac:     '#eab308',
  unused:  '#4b5563',
};

const SENSOR_COLOR  = '#14b8a6'; // teal-500
const CONTROL_COLOR = '#e11d48'; // rose-600 — distinct from PWM/DAC yellow
const ACTIVE_COLOR  = '#2563eb'; // blue-600

@Component({
  selector: 'app-device-board-svg',
  standalone: true,
  imports: [CommonModule, PinOverlayComponent],
  styles: [`
    @keyframes active-pulse {
      0%, 100% { opacity: 1; }
      50%      { opacity: 0.4; }
    }
    :host ::ng-deep .pin-active {
      animation: active-pulse 1s ease-in-out infinite;
    }
    :host ::ng-deep .board-svg-inner svg {
      width: 100%;
      height: auto;
      max-height: 500px;
      max-width: 480px;
    }
  `],
  template: `
    <div class="rounded-xl border border-base-300 bg-base-200/40 px-4 py-3">
      <p class="text-xs font-semibold text-base-content/40 uppercase tracking-wide mb-3">
        Board — {{ boardDef()?.label ?? 'GPIO Map' }}
      </p>

      @if (svgContent()) {
        <div class="board-svg-wrap-outer" style="position: relative"
             [style.padding.px]="80"
             [class]="'board-' + boardDef()?.model">
          <div class="board-svg-inner flex justify-center overflow-x-auto"
               #svgContainer
               [innerHTML]="svgContent()">
          </div>
          <app-pin-overlay
            [svgContainer]="svgContainer"
            [overlayItems]="overlayItems()"
            [domReady]="domReady()"
            [margin]="80"
          />
        </div>
      } @else if (!boardDef()) {
        <p class="text-xs text-base-content/40 py-4 text-center">
          No board diagram available for this device.
        </p>
      } @else {
        <div class="flex justify-center py-8">
          <span class="loading loading-spinner loading-sm"></span>
        </div>
      }

      <!-- Legend -->
      @if (boardDef()) {
        <div class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-base-content/60">
          <span class="flex items-center gap-1">
            <span class="inline-block w-2.5 h-2.5 rounded-full" style="background:#14b8a6"></span> Input
          </span>
          <span class="flex items-center gap-1">
            <span class="inline-block w-2.5 h-2.5 rounded-full" style="background:#e11d48"></span> Output
          </span>
          <span class="flex items-center gap-1">
            <span class="inline-block w-2.5 h-2.5 rounded-full" style="background:#2563eb"></span> Selected
          </span>
          @for (item of legendItems(); track item.label) {
            <span class="flex items-center gap-1">
              <span class="inline-block w-2.5 h-2.5 rounded-full" [style.backgroundColor]="item.color"></span>
              {{ item.label }}
            </span>
          }
        </div>
      }
    </div>
  `,
})
export class DeviceBoardSvgComponent {
  protected ctx = inject(ConfigContextService);
  private http = inject(HttpClient);
  private sanitizer = inject(DomSanitizer);

  @ViewChild('svgContainer') svgContainer!: ElementRef<HTMLDivElement>;

  private rawSvg = signal<string | null>(null);
  domReady = signal(0);

  boardDef = this.ctx.boardDef;

  svgContent = computed<SafeHtml | null>(() => {
    const raw = this.rawSvg();
    return raw ? this.sanitizer.bypassSecurityTrustHtml(raw) : null;
  });

  overlayItems = computed<PinOverlayItem[]>(() => {
    const def = this.boardDef();
    if (!def) return [];
    const sensorPins = this.ctx.usedSensorPins();
    const controlPins = this.ctx.usedControlPins();
    const activePin = this.ctx.activePinSelection();
    const pinMap = this.ctx.pinMapArray();
    const pinLabels = this.ctx.pinLabels();

    return def.pins
      .filter(pin => {
        const isActive = activePin === pin.firmware_idx;
        const isSensor = sensorPins.has(pin.firmware_idx);
        const isControl = controlPins.has(pin.firmware_idx);
        const hasLabel = pinLabels.has(pin.firmware_idx);
        return isActive || isSensor || isControl || hasLabel;
      })
      .map(pin => {
        const isActive = activePin === pin.firmware_idx;
        const isSensor = sensorPins.has(pin.firmware_idx);
        const isControl = controlPins.has(pin.firmware_idx);
        const hasLabel = pinLabels.has(pin.firmware_idx);

        let color: string;
        if (isActive) {
          color = ACTIVE_COLOR;
        } else if (isSensor || (hasLabel && !isControl)) {
          color = SENSOR_COLOR;
        } else if (isControl) {
          color = CONTROL_COLOR;
        } else {
          const fn = pinFunctionName(pinMap[pin.firmware_idx] ?? 0);
          color = FN_COLORS[fn] ?? FN_COLORS.unused;
        }

        return {
          firmwarePin: pin.firmware_idx,
          connectorId: pin.connector_id,
          color,
          label: pinLabels.get(pin.firmware_idx) ?? null,
          isActive,
          edge: pin.edge,
        };
      });
  });

  legendItems = computed(() => {
    const map = this.ctx.pinMapArray();
    const fnSet = new Set<PinFunctionName>();
    for (const code of map) {
      const fn = pinFunctionName(code);
      if (fn !== 'unused') fnSet.add(fn);
    }
    const labels: Record<string, string> = {
      relay: 'Relay/GPIO', button: 'GPIO', adc: 'ADC',
      i2c: 'I2C', onewire: '1-Wire', uart: 'UART',
      counter: 'Counter', pwm: 'PWM', dac: 'DAC',
    };
    return [...fnSet]
      .filter(fn => fn !== 'relay' || !fnSet.has('button'))
      .map(fn => ({ label: labels[fn] ?? fn, color: FN_COLORS[fn] }));
  });

  private svgLoadEffect = effect(() => {
    const def = this.boardDef();
    if (!def) { this.rawSvg.set(null); return; }
    this.http.get(def.svg_url, { responseType: 'text' }).subscribe({
      next: svg => {
        this.rawSvg.set(def.rotate_deg ? this.rotateSvg(svg, def.rotate_deg) : svg);
        // Double-rAF: first frame sets innerHTML, second ensures layout has stabilized
        requestAnimationFrame(() => requestAnimationFrame(() =>
          this.domReady.update(n => n + 1)
        ));
      },
      error: () => this.rawSvg.set(null),
    });
  });

  /** Apply fill colors directly to SVG pin elements. */
  private colorEffect = effect(() => {
    const def = this.boardDef();
    const _ready = this.domReady();
    const sensorPins = this.ctx.usedSensorPins();
    const controlPins = this.ctx.usedControlPins();
    const activePin = this.ctx.activePinSelection();
    const pinMap = this.ctx.pinMapArray();
    const pinLabels = this.ctx.pinLabels();

    if (!def || !_ready) return;

    requestAnimationFrame(() => {
      const container = this.svgContainer?.nativeElement;
      if (!container) return;

      for (const pin of def.pins) {
        const el = container.querySelector(`#${pin.connector_id}`) as SVGGraphicsElement | null;
        if (!el) continue;

        const isActive = activePin === pin.firmware_idx;
        const isSensor = sensorPins.has(pin.firmware_idx);
        const isControl = controlPins.has(pin.firmware_idx);
        const hasLabel = pinLabels.has(pin.firmware_idx);

        let color: string;
        if (isActive) {
          color = ACTIVE_COLOR;
        } else if (isSensor || (hasLabel && !isControl)) {
          color = SENSOR_COLOR;
        } else if (isControl) {
          color = CONTROL_COLOR;
        } else {
          const fn = pinFunctionName(pinMap[pin.firmware_idx] ?? 0);
          color = FN_COLORS[fn] ?? FN_COLORS.unused;
        }

        el.style.fill = color;
        el.style.fillOpacity = '1';
        el.classList.toggle('pin-active', isActive);
      }
    });
  });

  /** Rotate an SVG string by swapping the viewBox and wrapping content in a transform group. */
  private rotateSvg(svg: string, deg: number): string {
    const vbMatch = svg.match(/viewBox="([.\d]+)\s+([.\d]+)\s+([.\d]+)\s+([.\d]+)"/);
    if (!vbMatch) return svg;
    const [, minX, minY, w, h] = vbMatch;
    svg = svg.replace(
      `viewBox="${minX} ${minY} ${w} ${h}"`,
      `viewBox="${minX} ${minY} ${h} ${w}"`,
    );
    const wAttr = svg.match(/\bwidth="([^"]+)"/);
    const hAttr = svg.match(/\bheight="([^"]+)"/);
    if (wAttr && hAttr) {
      svg = svg
        .replace(`width="${wAttr[1]}"`, `width="${hAttr[1]}"`)
        .replace(`height="${hAttr[1]}"`, `height="${wAttr[1]}"`);
    }
    const insertAfter = svg.includes('</style>') ? '</style>' : /(<svg[^>]*>)/;
    const tx = deg === -90 ? `translate(0,${w})` : `translate(${h},0)`;
    svg = svg.replace(insertAfter, `$&<g transform="${tx} rotate(${deg})">`);
    svg = svg.replace('</svg>', '</g></svg>');
    return svg;
  }
}
