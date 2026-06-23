import { Component, computed, inject, input } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { renderTopologySvg, type SiteTopology } from '@core';

/**
 * Read-only topology diagram: the composed design rendered as an inline SVG
 * (`renderTopologySvg`, with the node-key legend) on the app's dark canvas.
 *
 * The one place the render + sanitize + dark frame live, so every surface that
 * shows a design (the public estimator, the admin leads view, lead conversion)
 * looks identical. Renders nothing when there is no design, so callers can place
 * it unconditionally or behind their own disclosure.
 */
@Component({
  selector: 'app-topology-preview',
  standalone: true,
  template: `
    @if (svg(); as html) {
      <div class="rounded-lg overflow-hidden bg-slate-950 p-2 ring-1 ring-white/10" [innerHTML]="html"></div>
    }
  `,
})
export class TopologyPreviewComponent {
  /** The design to draw; nothing renders when null or empty. */
  readonly topology = input<Pick<SiteTopology, 'nodes' | 'pipes'> | null>(null);

  private sanitizer = inject(DomSanitizer);

  protected readonly svg = computed<SafeHtml | null>(() => {
    const t = this.topology();
    return t && t.nodes?.length ? this.sanitizer.bypassSecurityTrustHtml(renderTopologySvg(t)) : null;
  });
}
