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
        <div class="flex flex-col items-center justify-center h-48 bg-base-200 rounded-lg gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-base-content/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
          </svg>
          <span class="text-base-content/30 text-sm">No board SVG available</span>
          <span class="text-base-content/20 text-xs">Pin visualization requires a board SVG file</span>
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
