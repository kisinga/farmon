import {
  Component,
  input,
  computed,
  signal,
  effect,
  ElementRef,
  viewChild,
  inject,
} from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import type { BoardDef, PinDef } from '../../core/models/board.model';
import { PIN_COLORS, reservedPins } from '../../core/models/board.model';

interface PinOverlay {
  pin: PinDef;
  color: string;
  label: string;
  tooltip: string;
  x: number;
  y: number;
}

@Component({
  selector: 'app-board-svg',
  standalone: true,
  template: `
    <div class="relative w-full" #container>
      @if (sanitizedSvg()) {
        <div
          class="w-full [&_svg]:w-full [&_svg]:h-auto"
          [innerHTML]="sanitizedSvg()"
          #svgHost
        ></div>
      } @else {
        <div class="flex items-center justify-center h-48 bg-base-200 rounded-lg">
          <span class="text-base-content/30">No board SVG loaded</span>
        </div>
      }

      @for (overlay of overlays(); track overlay.pin.gpio) {
        <div
          class="absolute text-[9px] font-bold text-white px-1 rounded shadow-sm cursor-pointer
                 transform -translate-x-1/2 -translate-y-1/2 whitespace-nowrap select-none"
          [style.left.px]="overlay.x"
          [style.top.px]="overlay.y"
          [style.backgroundColor]="overlay.color"
          [title]="overlay.tooltip"
          (click)="onPinClick(overlay.pin)"
        >
          {{ overlay.label }}
        </div>
      }
    </div>
  `,
})
export class BoardSvgComponent {
  board = input<BoardDef | null>(null);
  svgContent = input<string | null>(null);
  usedPins = input<Map<string, string>>(new Map());
  selectedPin = input<string | null>(null);
  onPinSelected = input<((pin: PinDef) => void) | null>(null);

  private sanitizer = inject(DomSanitizer);
  private svgHost = viewChild<ElementRef<HTMLDivElement>>('svgHost');
  private overlayPositions = signal<Map<string, { x: number; y: number }>>(new Map());

  sanitizedSvg = computed<SafeHtml | null>(() => {
    const svg = this.svgContent();
    return svg ? this.sanitizer.bypassSecurityTrustHtml(svg) : null;
  });

  overlays = computed<PinOverlay[]>(() => {
    const b = this.board();
    if (!b) return [];

    const used = this.usedPins();
    const reserved = reservedPins(b);
    const sel = this.selectedPin();
    const positions = this.overlayPositions();

    return b.pins.map((pin) => {
      const pos = positions.get(pin.connector) ?? { x: 0, y: 0 };
      const usage = used.get(pin.gpio);
      const reservedReason = reserved.get(pin.gpio);

      let color: string = PIN_COLORS.available;
      let label = pin.gpio.replace('GPIO', '');

      if (sel === pin.gpio) {
        color = PIN_COLORS.selected;
      } else if (reservedReason) {
        color = PIN_COLORS.reserved;
      } else if (usage) {
        const [type] = usage.split(':');
        color = (PIN_COLORS as Record<string, string>)[type] ?? PIN_COLORS.available;
        label = usage.split(':').slice(1).join(':') || label;
      }

      const caps = pin.caps.join(', ');
      const tooltip = reservedReason
        ? `${pin.gpio} — reserved: ${reservedReason}`
        : usage
          ? `${pin.gpio} — ${usage} [${caps}]`
          : `${pin.gpio} — available [${caps}]`;

      return { pin, color, label, tooltip, x: pos.x, y: pos.y };
    });
  });

  constructor() {
    // Recalculate overlay positions when SVG is rendered
    effect(() => {
      const svg = this.svgContent();
      const board = this.board();
      if (!svg || !board) return;

      // Wait for DOM to render the SVG
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.calculatePositions(board);
        });
      });
    });
  }

  private calculatePositions(board: BoardDef) {
    const host = this.svgHost()?.nativeElement;
    if (!host) return;

    const svgEl = host.querySelector('svg');
    if (!svgEl) return;

    const containerRect = host.getBoundingClientRect();
    const positions = new Map<string, { x: number; y: number }>();

    for (const pin of board.pins) {
      const el = svgEl.querySelector(`[id*="${pin.connector}"]`);
      if (!el) continue;

      const rect = el.getBoundingClientRect();
      positions.set(pin.connector, {
        x: rect.left - containerRect.left + rect.width / 2,
        y: rect.top - containerRect.top + rect.height / 2,
      });
    }

    this.overlayPositions.set(positions);
  }

  onPinClick(pin: PinDef) {
    const handler = this.onPinSelected();
    if (handler) handler(pin);
  }
}
