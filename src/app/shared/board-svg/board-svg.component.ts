import {
  Component,
  input,
  effect,
  ElementRef,
  viewChild,
} from '@angular/core';
import type { BoardDef, PinUsage } from '@core';
import {
  calloutLabelsFor, layoutCallouts, buildCalloutMarkup,
  measureConnectors, svgViewBox,
} from '@core';

/**
 * Renders a board's SVG with connected-pin callout labels baked on top, using the
 * same shared layout the documentation generator uses — so the editor and the
 * published docs match, and labels never overlap (each parks in a board margin
 * with a leader line back to its pin). Display-only.
 */
@Component({
  selector: 'app-board-svg',
  standalone: true,
  template: `
    @if (svgContent()) {
      <div class="w-full [&_svg]:w-full [&_svg]:h-auto" #svgHost></div>
    } @else {
      <div class="flex flex-col items-center justify-center h-48 bg-base-200 rounded-lg gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-base-content/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
        </svg>
        <span class="text-base-content/50 text-sm">No board SVG available</span>
        <span class="text-base-content/40 text-xs">Pin visualization requires a board SVG file</span>
      </div>
    }
  `,
})
export class BoardSvgComponent {
  board = input<BoardDef | null>(null);
  svgContent = input<string | null>(null);
  /** Connected-pin usages for this board's controller (each gets a callout). */
  usages = input<PinUsage[]>([]);

  private svgHost = viewChild<ElementRef<HTMLDivElement>>('svgHost');

  constructor() {
    effect(() => {
      const base = this.svgContent();
      const board = this.board();
      const usages = this.usages();
      const host = this.svgHost()?.nativeElement;
      if (!host || !base) return;
      // Reset to the pristine board SVG (clears any prior callouts), then bake
      // once the host has laid out so connector geometry is measurable. The board
      // SVG is admin-curated catalog content, injected as-is like before.
      host.innerHTML = base;
      if (!board) return;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => this.bakeCallouts(board, usages)),
      );
    });
  }

  private bakeCallouts(board: BoardDef, usages: PinUsage[]): void {
    const svg = this.svgHost()?.nativeElement.querySelector('svg');
    if (!svg) return;
    const labels = calloutLabelsFor(board, usages);
    if (!labels.length) return;
    const geoms = measureConnectors(svg, labels.map((l) => l.connector));
    if (!geoms.length) return;
    const placement = layoutCallouts(geoms, labels, svgViewBox(svg));
    const vb = placement.viewBox;
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.width} ${vb.height}`);
    svg.insertAdjacentHTML('beforeend', buildCalloutMarkup(placement));
  }
}
