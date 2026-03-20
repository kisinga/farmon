import {
  Component, input, signal, computed, effect,
  DestroyRef, inject, afterNextRender, ChangeDetectorRef,
  ElementRef, ViewChild,
} from '@angular/core';
import { PinOverlayItem, PositionedCallout, PinEdge } from './pin-overlay.types';

declare const ngDevMode: boolean | undefined;

const CHAR_WIDTH = 6.5; // approximate px per character at font-size 11

@Component({
  selector: 'app-pin-overlay',
  standalone: true,
  styles: [`
    :host { display: contents; }
    .leader-overlay {
      position: absolute;
      top: 0; left: 0;
      width: 100%; height: 100%;
      pointer-events: none;
      overflow: visible;
    }
    @keyframes callout-pulse {
      0%, 100% { r: 5; opacity: 1; }
      50%      { r: 7; opacity: 0.5; }
    }
    .pin-dot-active { animation: callout-pulse 1s ease-in-out infinite; }
    .label-bg {
      fill: white;
      fill-opacity: 0.85;
    }
  `],
  template: `
    <svg #overlaySvg class="leader-overlay"
         xmlns="http://www.w3.org/2000/svg"
         [attr.viewBox]="viewBox()">
      @for (c of callouts(); track c.firmwarePin) {
        @if (c.label) {
          <!-- Leader line -->
          <line [attr.x1]="c.pinX" [attr.y1]="c.pinY"
                [attr.x2]="c.labelX" [attr.y2]="c.labelY"
                [attr.stroke]="c.color" stroke-width="1" stroke-opacity="0.5"
                stroke-dasharray="3 2" />
          <!-- Label background -->
          <rect [attr.x]="labelBgX(c)" [attr.y]="c.labelY - 7"
                [attr.width]="c.label.length * 6.5 + 6" height="14" rx="3"
                class="label-bg" />
          <!-- Label text -->
          <text [attr.x]="c.labelX" [attr.y]="c.labelY"
                [attr.fill]="c.color" [attr.text-anchor]="c.textAnchor"
                dominant-baseline="central"
                font-size="11" font-weight="600">
            {{ c.label }}
          </text>
        }
        <!-- Dot at pin -->
        <circle [attr.cx]="c.pinX" [attr.cy]="c.pinY" r="5"
                [attr.fill]="c.color" stroke="white" stroke-width="1.5"
                [class.pin-dot-active]="c.isActive" />
      }
    </svg>
  `,
})
export class PinOverlayComponent {
  svgContainer = input.required<HTMLDivElement>();
  overlayItems = input.required<PinOverlayItem[]>();
  domReady = input.required<number>();
  margin = input<number>(80);

  @ViewChild('overlaySvg') overlaySvg!: ElementRef<SVGSVGElement>;

  private destroyRef = inject(DestroyRef);
  private cdr = inject(ChangeDetectorRef);
  private layoutVersion = signal(0);
  private resizeObs?: ResizeObserver;

  viewBox = signal('0 0 0 0');
  callouts = signal<PositionedCallout[]>([]);

  /** Compute background rect X based on text-anchor */
  labelBgX(c: PositionedCallout): number {
    const w = c.label.length * 6.5 + 6;
    if (c.textAnchor === 'end') return c.labelX - w;
    if (c.textAnchor === 'middle') return c.labelX - w / 2;
    return c.labelX; // 'start'
  }

  private positionEffect = effect(() => {
    const items = this.overlayItems();
    const container = this.svgContainer();
    const _layout = this.layoutVersion();
    const _ready = this.domReady();
    const marginPx = this.margin();
    if (!container || !items.length) {
      this.callouts.set([]);
      return;
    }

    requestAnimationFrame(() => {
      const svg = this.overlaySvg?.nativeElement;
      if (!svg) {
        // Overlay SVG not rendered yet — retry on next frame
        setTimeout(() => this.layoutVersion.update(n => n + 1), 50);
        return;
      }

      const overlayRect = svg.getBoundingClientRect();
      if (overlayRect.width === 0) { this.callouts.set([]); return; }

      // Resolve pin positions and filter to labeled items
      const resolved: (PinOverlayItem & { pinX: number; pinY: number })[] = [];
      for (const item of items) {
        if (!item.label) continue;
        const el = container.querySelector(`#${item.connectorId}`);
        if (!el) {
          if (typeof ngDevMode === 'undefined' || ngDevMode) {
            console.warn(`[pin-overlay] connectorId "${item.connectorId}" not found in SVG`);
          }
          continue;
        }
        const r = el.getBoundingClientRect();
        resolved.push({
          ...item,
          pinX: r.x + r.width / 2 - overlayRect.x,
          pinY: r.y + r.height / 2 - overlayRect.y,
        });
      }

      // Also add dots for items without labels (active/assigned pins)
      const dotsOnly: PositionedCallout[] = [];
      for (const item of items) {
        if (item.label) continue; // already in resolved
        const el = container.querySelector(`#${item.connectorId}`);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        dotsOnly.push({
          firmwarePin: item.firmwarePin,
          color: item.color,
          label: '',
          isActive: item.isActive,
          edge: item.edge,
          pinX: r.x + r.width / 2 - overlayRect.x,
          pinY: r.y + r.height / 2 - overlayRect.y,
          labelX: 0, labelY: 0,
          textAnchor: 'start',
        });
      }

      const vw = overlayRect.width;
      const vh = overlayRect.height;
      this.viewBox.set(`0 0 ${vw} ${vh}`);

      // Group labeled items by edge
      const groups = new Map<PinEdge, typeof resolved>();
      for (const item of resolved) {
        const list = groups.get(item.edge) ?? [];
        list.push(item);
        groups.set(item.edge, list);
      }

      const positioned: PositionedCallout[] = [];

      for (const [edge, group] of groups) {
        // Sort by natural coordinate along the edge
        const isHorizontal = edge === 'top' || edge === 'bottom';
        group.sort((a, b) => isHorizontal ? a.pinX - b.pinX : a.pinY - b.pinY);

        // Assign label positions and de-overlap using per-label width
        const coords = group.map(g => isHorizontal ? g.pinX : g.pinY);
        const labelWidths = group.map(g => (g.label?.length ?? 0) * 6.5 + 10);
        const adjusted = deoverlapWithWidths(coords, labelWidths);

        for (let i = 0; i < group.length; i++) {
          const g = group[i];
          let labelX: number, labelY: number;
          let textAnchor: 'start' | 'end' | 'middle' = 'middle';

          if (edge === 'top') {
            labelX = adjusted[i];
            labelY = Math.max(12, g.pinY - marginPx * 0.6);
            textAnchor = 'middle';
          } else if (edge === 'bottom') {
            labelX = adjusted[i];
            labelY = Math.min(vh - 4, g.pinY + marginPx * 0.6);
            textAnchor = 'middle';
          } else if (edge === 'left') {
            labelX = Math.max(4, g.pinX - marginPx * 0.6);
            labelY = adjusted[i];
            textAnchor = 'end';
          } else {
            labelX = Math.min(vw - 4, g.pinX + marginPx * 0.6);
            labelY = adjusted[i];
            textAnchor = 'start';
          }

          positioned.push({
            firmwarePin: g.firmwarePin,
            color: g.color,
            label: g.label!,
            isActive: g.isActive,
            edge: g.edge,
            pinX: g.pinX,
            pinY: g.pinY,
            labelX,
            labelY,
            textAnchor,
          });
        }
      }

      // Dots-only items don't get lines/labels but render as circles
      // We include them with empty label — the template @if on label handles it
      // Actually we render all; the template shows line+text only when label exists
      // Dots-only still get a circle. Add them with label='' so template skips line/text.
      // Simplification: include dots-only in callouts; template already renders circle for all.
      this.callouts.set([...positioned, ...dotsOnly]);
      this.cdr.markForCheck();
    });
  });

  constructor() {
    afterNextRender(() => {
      const container = this.svgContainer();
      if (!container) return;
      this.resizeObs = new ResizeObserver(() =>
        this.layoutVersion.update(n => n + 1)
      );
      this.resizeObs.observe(container);
    });

    this.destroyRef.onDestroy(() => this.resizeObs?.disconnect());
  }
}

/** Greedy de-overlap using per-label widths. Gap = half of prev width + half of current width. */
function deoverlapWithWidths(coords: number[], widths: number[]): number[] {
  const result = [...coords];
  for (let i = 1; i < result.length; i++) {
    const gap = (widths[i - 1] + widths[i]) / 2;
    if (result[i] - result[i - 1] < gap) {
      result[i] = result[i - 1] + gap;
    }
  }
  return result;
}
