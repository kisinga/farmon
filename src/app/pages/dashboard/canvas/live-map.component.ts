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
    <div class="relative w-full rounded-2xl ring-1 ring-base-300/30 overflow-hidden" style="height: min(70vh, 640px)">
      <div #host class="absolute inset-0"></div>
    </div>
  `,
})
export class LiveMapComponent implements OnDestroy {
  readonly topology = input<SiteTopology | null>(null);
  readonly runtime = input<Map<string, NodeRuntime>>(new Map());
  /** Nodes + pipes of currently-running routes — the engaged path the map lights. */
  readonly activePath = input<ActivePath>({ nodes: new Set(), pipes: new Set() });

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

  private renderTopology(): void {
    const topo = this.topology();
    if (!this.canvas || !topo) return;
    // render() refits itself when the node set changes; don't fit here or we'd
    // reset the operator's pan/zoom on unrelated re-renders.
    this.canvas.render(topo);
    this.canvas.setState(this.runtime());
    this.canvas.setActivePath(this.activePath());
  }
}
