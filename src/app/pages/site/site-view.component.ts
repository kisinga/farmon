import {
  Component, inject, OnInit, OnDestroy, signal,
  ElementRef, ViewChild, AfterViewInit, NgZone,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { WorkspaceService } from '../../core/services/workspace.service';
import { X6Canvas, type CanvasEvents } from '../editor/topology-x6-tab/x6-canvas';
import { renderBoundaries } from '../../shared/canvas/boundary-renderer';
import type { TopologyNode } from '../../core/models/topology.model';

@Component({
  selector: 'app-site-view',
  standalone: true,
  host: { class: 'flex-1 flex overflow-hidden' },
  template: `
    <div class="flex-1 flex flex-col min-w-0 overflow-hidden">
      <!-- Toolbar -->
      <div class="flex items-center gap-2 px-4 py-2 bg-base-100 border-b border-base-300/50 shrink-0">
        <span class="text-xs text-base-content/50 flex-1">Site topology</span>
        <button class="btn btn-ghost btn-xs btn-square" (click)="zoomIn()" title="Zoom in">+</button>
        <button class="btn btn-ghost btn-xs btn-square" (click)="zoomOut()" title="Zoom out">&minus;</button>
        <button class="btn btn-ghost btn-xs" (click)="fit()" title="Fit content">Fit</button>
      </div>
      <div class="flex-1 min-h-0 overflow-hidden" #canvasWrap>
        <div #canvasEl class="w-full h-full"></div>
      </div>
    </div>
  `,
})
export class SiteViewComponent implements OnInit, AfterViewInit, OnDestroy {
  private workspace = inject(WorkspaceService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private zone = inject(NgZone);

  @ViewChild('canvasEl') canvasElRef!: ElementRef<HTMLElement>;
  @ViewChild('canvasWrap') canvasWrapRef!: ElementRef<HTMLElement>;

  protected loading = signal(true);

  private canvas: X6Canvas | null = null;
  private resizeObserver: ResizeObserver | null = null;

  async ngOnInit() {
    const siteName = this.route.snapshot.paramMap.get('name');
    if (!siteName) { this.router.navigate(['/overview']); return; }
    await this.workspace.load(siteName);
    this.loading.set(false);
  }

  ngAfterViewInit() {
    const checkAndInit = () => {
      if (!this.workspace.site() || !this.canvasElRef) {
        setTimeout(checkAndInit, 50);
        return;
      }
      this.initCanvas();
    };
    checkAndInit();
  }

  ngOnDestroy() {
    this.resizeObserver?.disconnect();
    this.canvas?.destroy();
  }

  private initCanvas() {
    const canvasEl = this.canvasElRef.nativeElement;
    const canvasWrap = this.canvasWrapRef.nativeElement;

    const noopEvents: CanvasEvents = {
      onNodesMoved: () => {},
      onPipeCreated: () => {},
      onPipeDeleted: () => {},
      onSelected: () => {},
      onDanglingPipe: () => {},
    };

    this.canvas = new X6Canvas(canvasEl, noopEvents);
    this.canvas.setReadonly(true);

    // Resize to actual container before rendering (matches editor init order)
    const w = canvasWrap.clientWidth;
    const h = canvasWrap.clientHeight;
    if (w > 0 && h > 0) this.canvas.resize(w, h);

    this.renderComposite();

    this.resizeObserver = new ResizeObserver(() => {
      this.canvas?.resize(canvasWrap.clientWidth, canvasWrap.clientHeight);
    });
    this.resizeObserver.observe(canvasWrap);
  }

  /**
   * Render each system independently using X6Canvas primitives.
   * For each system: add its nodes, then its edges.
   * The manhattan router only sees that system's nodes (+ previously rendered systems)
   * as obstacles, producing the same routing as the per-device editor.
   */
  private renderComposite() {
    if (!this.canvas) return;
    const site = this.workspace.site();
    const systems = this.workspace.systems();
    if (!site || systems.size === 0) return;

    this.canvas.clear();

    const systemNodes = new Map<string, string[]>();

    for (const sp of site.systems) {
      const data = systems.get(sp.config);
      if (!data) continue;

      // Offset node positions for this system's placement
      const offsetNodes: TopologyNode[] = data.topology.nodes.map(node => ({
        ...node,
        position: {
          x: node.position.x + sp.position.x,
          y: node.position.y + sp.position.y,
        },
      } as TopologyNode));

      // Add this system's nodes, then its edges — router sees only
      // this system's nodes (+ any previously added systems)
      this.canvas.addNodes(offsetNodes);
      this.canvas.addEdges(data.topology.pipes);

      systemNodes.set(sp.config, data.topology.nodes.map(n => n.id));
    }

    this.canvas.fitContent();
    renderBoundaries(this.canvas.graphInstance, systemNodes);
  }

  protected zoomIn() { this.canvas?.zoomIn(); }
  protected zoomOut() { this.canvas?.zoomOut(); }
  protected fit() { this.canvas?.fitContent(); }
}
