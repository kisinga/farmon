import {
  Component, computed, inject, signal, effect,
  ElementRef, ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ConfigContextService } from '../../../core/services/config-context.service';
import { BOARD_DEFINITIONS, BoardPinDef } from '../../../core/constants/board-definitions';
import { pinFunctionName, PinFunctionName } from '../../../core/utils/firmware-constraints';

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
const CONTROL_COLOR = '#f59e0b'; // amber-500
const ACTIVE_COLOR  = '#2563eb'; // blue-600
const LABEL_NS = 'http://www.w3.org/2000/svg';

@Component({
  selector: 'app-device-board-svg',
  standalone: true,
  imports: [CommonModule],
  styles: [`
    @keyframes active-pulse {
      0%, 100% { opacity: 1; }
      50%      { opacity: 0.4; }
    }
    :host ::ng-deep .pin-active {
      animation: active-pulse 1s ease-in-out infinite;
    }
    :host ::ng-deep .board-svg-wrap svg {
      width: 100%;
      height: auto;
      max-height: 500px;
    }
    /* LoRa-E5 is a wide/short board — cap width so it doesn't stretch across the page */
    :host ::ng-deep .board-svg-wrap.board-lorae5 svg {
      max-width: 480px;
    }
  `],
  template: `
    <div class="rounded-xl border border-base-300 bg-base-200/40 px-4 py-3">
      <p class="text-xs font-semibold text-base-content/40 uppercase tracking-wide mb-3">
        Board — {{ boardDef()?.label ?? 'GPIO Map' }}
      </p>

      @if (svgContent()) {
        <div class="board-svg-wrap flex justify-center overflow-x-auto"
          [class]="'board-svg-wrap board-' + boardDef()?.model"
          #svgContainer
          [innerHTML]="svgContent()">
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
            <span class="inline-block w-2.5 h-2.5 rounded-full" style="background:#f59e0b"></span> Output
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
  private domReady = signal(0);

  boardDef = computed(() => {
    const model = this.ctx.device()?.hardware_model;
    return model ? BOARD_DEFINITIONS[model] ?? null : null;
  });

  svgContent = computed<SafeHtml | null>(() => {
    const raw = this.rawSvg();
    return raw ? this.sanitizer.bypassSecurityTrustHtml(raw) : null;
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
    this.http.get(def.svgUrl, { responseType: 'text' }).subscribe({
      next: svg => {
        this.rawSvg.set(svg);
        requestAnimationFrame(() => this.domReady.update(n => n + 1));
      },
      error: () => this.rawSvg.set(null),
    });
  });

  private colorEffect = effect(() => {
    const def = this.boardDef();
    const _ready = this.domReady();
    const sensorPins = this.ctx.usedSensorPins();
    const controlPins = this.ctx.usedControlPins();
    const activePin = this.ctx.activePinSelection();
    const pinMap = this.ctx.pinMapArray();
    const pinLabels = this.ctx.pinLabels();

    if (!def || !_ready) return;

    requestAnimationFrame(() =>
      this.applyPinState(def.pins, sensorPins, controlPins, activePin, pinMap, pinLabels)
    );
  });

  /**
   * Get the center of an SVG element in root SVG coordinate space.
   * Uses getBoundingClientRect + inverse screen CTM as a robust fallback.
   */
  private pinCenter(el: SVGGraphicsElement, svgEl: SVGSVGElement): { x: number; y: number } | null {
    // Method 1: getBoundingClientRect → SVG coords (most reliable for nested transforms)
    try {
      const rect = el.getBoundingClientRect();
      const svgRect = svgEl.getBoundingClientRect();
      const vb = svgEl.viewBox.baseVal;
      if (svgRect.width === 0 || svgRect.height === 0) return null;
      // Map screen coords to viewBox coords
      const scaleX = vb.width / svgRect.width;
      const scaleY = vb.height / svgRect.height;
      return {
        x: vb.x + (rect.x + rect.width / 2 - svgRect.x) * scaleX,
        y: vb.y + (rect.y + rect.height / 2 - svgRect.y) * scaleY,
      };
    } catch {
      return null;
    }
  }

  private applyPinState(
    pins: BoardPinDef[],
    sensorPins: Set<number>,
    controlPins: Set<number>,
    activePin: number | null,
    pinMap: number[],
    pinLabels: Map<number, string>,
  ): void {
    const container = this.svgContainer?.nativeElement;
    if (!container) return;
    const svgEl = container.querySelector('svg') as SVGSVGElement | null;
    if (!svgEl) return;

    // Remove previously injected overlays
    svgEl.querySelectorAll('.farmon-overlay').forEach(el => el.remove());

    // Parse viewBox to determine label offset scale
    const vb = svgEl.viewBox.baseVal;
    const dotRadius = Math.max(vb.width, vb.height) * 0.012;
    const fontSize = Math.max(vb.width, vb.height) * 0.018;
    const labelOffset = dotRadius + fontSize * 0.3;

    for (const pin of pins) {
      const el = container.querySelector(`#${pin.connectorId}`) as SVGGraphicsElement | null;
      if (!el) continue;

      // Determine status color
      const isActive = activePin === pin.firmwarePin;
      const isSensor = sensorPins.has(pin.firmwarePin);
      const isControl = controlPins.has(pin.firmwarePin);
      const hasLabel = pinLabels.has(pin.firmwarePin);
      const isAssigned = isSensor || isControl || isActive || hasLabel;

      let color: string;
      if (isActive) {
        color = ACTIVE_COLOR;
      } else if (isSensor || (hasLabel && !isControl)) {
        color = SENSOR_COLOR;
      } else if (isControl) {
        color = CONTROL_COLOR;
      } else {
        const fn = pinFunctionName(pinMap[pin.firmwarePin] ?? 0);
        color = FN_COLORS[fn] ?? FN_COLORS.unused;
      }

      // Color the original pin element
      el.style.fill = color;
      el.style.fillOpacity = '1';
      el.classList.toggle('pin-active', isActive);

      if (!isAssigned) continue;

      // Get pin center in root SVG coords
      try {
        const center = this.pinCenter(el, svgEl);
        if (!center) continue;

        // Colored dot overlay
        const dot = document.createElementNS(LABEL_NS, 'circle');
        dot.classList.add('farmon-overlay');
        if (isActive) dot.classList.add('pin-active');
        dot.setAttribute('cx', String(center.x));
        dot.setAttribute('cy', String(center.y));
        dot.setAttribute('r', String(dotRadius));
        dot.setAttribute('fill', color);
        dot.setAttribute('stroke', 'white');
        dot.setAttribute('stroke-width', String(dotRadius * 0.3));
        svgEl.appendChild(dot);

        // Text label
        const label = pinLabels.get(pin.firmwarePin);
        if (label) {
          const text = document.createElementNS(LABEL_NS, 'text');
          text.classList.add('farmon-overlay');
          text.setAttribute('x', String(center.x + labelOffset));
          text.setAttribute('y', String(center.y));
          text.setAttribute('font-size', String(fontSize));
          text.setAttribute('font-family', 'system-ui, sans-serif');
          text.setAttribute('font-weight', '600');
          text.setAttribute('fill', color);
          text.setAttribute('dominant-baseline', 'central');
          text.textContent = label;
          svgEl.appendChild(text);
        }
      } catch {
        // getBBox can throw if element is not rendered
      }
    }
  }
}
