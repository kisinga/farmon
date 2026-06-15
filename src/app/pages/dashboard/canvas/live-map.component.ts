import {
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  effect,
  input,
  viewChild,
} from '@angular/core';
import type { SiteTopology } from '../../../core/models/topology.model';
import type { NodeRuntime } from '@core';
import { LiveCanvas, type ActivePath } from './live-canvas';

/**
 * Dumb host for the live SCADA map. Owns the `LiveCanvas` lifecycle and pushes
 * the topology + live state into it; all derivation lives in the dashboard
 * (the SSOT), so this component just renders what it's given.
 */
@Component({
  selector: 'app-live-map',
  standalone: true,
  template: `
    <div class="relative w-full rounded-2xl ring-1 ring-base-300/40 overflow-hidden shadow-lg shadow-black/20 bg-[#0f172a]"
         style="height: min(70vh, 640px)">
      <div #host class="absolute inset-0"></div>

      <!-- Zoom controls — buttons only. Wheel-zoom is locked so scrolling the
           dashboard never zooms the map by accident. -->
      <div class="absolute top-3 right-3 z-10 flex flex-col gap-1.5">
        <button type="button" (click)="zoomIn()" title="Zoom in" aria-label="Zoom in"
                class="grid place-items-center h-7 w-7 rounded-lg bg-slate-800/80 backdrop-blur ring-1 ring-white/10 text-slate-200 hover:bg-slate-700/90 hover:text-white transition">
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2"><path stroke-linecap="round" d="M12 5v14M5 12h14"/></svg>
        </button>
        <button type="button" (click)="zoomOut()" title="Zoom out" aria-label="Zoom out"
                class="grid place-items-center h-7 w-7 rounded-lg bg-slate-800/80 backdrop-blur ring-1 ring-white/10 text-slate-200 hover:bg-slate-700/90 hover:text-white transition">
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2"><path stroke-linecap="round" d="M5 12h14"/></svg>
        </button>
        <button type="button" (click)="fit()" title="Fit to view" aria-label="Fit to view"
                class="grid place-items-center h-7 w-7 rounded-lg bg-slate-800/80 backdrop-blur ring-1 ring-white/10 text-slate-200 hover:bg-slate-700/90 hover:text-white transition">
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 9V5a1 1 0 011-1h4M20 9V5a1 1 0 00-1-1h-4M4 15v4a1 1 0 001 1h4M20 15v4a1 1 0 01-1 1h-4"/></svg>
        </button>
      </div>

      <!-- Legend — the live vocabulary at a glance, frosted so it reads over the grid. -->
      <div class="absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-slate-900/70 backdrop-blur px-2.5 py-1.5 ring-1 ring-white/10 text-[10px] font-medium text-slate-300">
        <span class="inline-flex items-center gap-1.5"><span class="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_5px_1px] shadow-emerald-400/70"></span>Active</span>
        <span class="inline-flex items-center gap-1.5"><span class="h-0.5 w-4 rounded bg-sky-400"></span>Flow</span>
        <span class="inline-flex items-center gap-1.5"><span class="h-2 w-2 rounded-full bg-red-500 shadow-[0_0_5px_1px] shadow-red-500/70"></span>Fault</span>
        <span class="inline-flex items-center gap-1.5 opacity-50"><span class="h-2 w-2 rounded-full bg-slate-500"></span>Offline</span>
        <span class="hidden sm:inline text-slate-500">· drag to pan</span>
      </div>
    </div>
  `,
})
export class LiveMapComponent implements OnDestroy {
  readonly topology = input<SiteTopology | null>(null);
  readonly runtime = input<Map<string, NodeRuntime>>(new Map());
  /** Nodes + pipes a route contributes, bucketed by state (active / fault) — the
   *  overlay the map lights. */
  readonly activePath = input<ActivePath>({ nodes: new Set(), pipes: new Set(), faultNodes: new Set(), faultPipes: new Set() });

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private canvas: LiveCanvas | null = null;
  private resizeObs: ResizeObserver | null = null;

  constructor() {
    afterNextRender(() => {
      const el = this.host().nativeElement;
      this.canvas = new LiveCanvas(el);
      this.resizeObs = new ResizeObserver(() => this.canvas?.resize(el.clientWidth, el.clientHeight));
      this.resizeObs.observe(el);
      this.renderTopology();
    });

    // Re-render when the topology arrives/changes, then fit.
    effect(() => {
      this.topology();
      this.renderTopology();
    });

    // Push live state on every shadow update (cheap class toggles).
    effect(() => {
      const runtime = this.runtime();
      this.canvas?.setState(runtime);
    });

    // Light the engaged path (nodes + pipes) as routes start/stop.
    effect(() => {
      const path = this.activePath();
      this.canvas?.setActivePath(path);
    });
  }

  ngOnDestroy(): void {
    this.resizeObs?.disconnect();
    this.canvas?.destroy();
  }

  // Zoom controls — the only way to zoom (wheel-zoom is locked in the canvas).
  protected zoomIn(): void { this.canvas?.zoomIn(); }
  protected zoomOut(): void { this.canvas?.zoomOut(); }
  protected fit(): void { this.canvas?.fit(); }

  private renderTopology(): void {
    const topo = this.topology();
    if (!this.canvas || !topo) return;
    // render() refits itself when the node set changes; don't fit here or we'd
    // reset the operator's pan/zoom on unrelated re-renders.
    const friendlyNames = new Map<string, string>();
    for (const c of topo.controllers ?? []) friendlyNames.set(c.id, c.friendlyName ?? c.id);
    this.canvas.render(topo, {
      controllers: topo.controllers,
      friendlyNames,
      positions: topo.layout?.controllers,
    });
    this.canvas.setState(this.runtime());
    this.canvas.setActivePath(this.activePath());
  }
}
