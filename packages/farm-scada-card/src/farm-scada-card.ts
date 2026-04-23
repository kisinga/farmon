/**
 * farm-scada-card — Home Assistant custom card that renders a MajiFlow
 * topology SVG with live entity state, per-node action menus, live value
 * bindings, and pipe flow animation.
 *
 * Contract: consumes artifacts produced by `TopologyRenderer.exportHa()` in
 * the MajiFlow editor. Artifacts are fetched from `/local/<source>` (bind-
 * mounted in the HA container).
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { stateBucket, applyStateClass } from './state';
import { resolveBind } from './value-bindings';
import { installMenuListeners, type MenuPosition } from './menu';
import {
  SUPPORTED_SCHEMA_VERSION,
  type FarmScadaCardConfig,
  type HaActionSpec,
  type HaMeta,
} from './schema';

interface HassLike {
  states: Record<string, { state: string; attributes?: Record<string, unknown> }>;
  callService(domain: string, service: string, data?: Record<string, unknown>): Promise<unknown>;
  connection?: { connected?: boolean };
}

const FLOW_PRED_RE = /^fromEntity\.state\s*==\s*'([^']+)'$/;

@customElement('farm-scada-card')
export class FarmScadaCard extends LitElement {
  // Hass injects this; we don't render on every change, only diff in updated().
  @property({ attribute: false }) hass?: HassLike;

  @state() private config?: FarmScadaCardConfig;
  @state() private loadError?: string;
  @state() private menu: { nodeId: string; pos: MenuPosition } | null = null;
  @state() private svgReady = false;

  private svg: SVGSVGElement | null = null;
  private meta: HaMeta | null = null;
  private teardownMenu: (() => void) | null = null;
  private lastStates = new Map<string, string>();
  private nodeGroups = new Map<string, SVGGElement>();
  private pipeGroups = new Map<string, SVGGElement>();
  private slotEls = new Map<string, Map<string, SVGTextElement>>();

  // --- HA card API ---

  setConfig(config: FarmScadaCardConfig): void {
    if (!config || !config.source) throw new Error('farm-scada-card: `source` is required (path to SVG)');
    if (!config.meta) throw new Error('farm-scada-card: `meta` is required (path to meta.json)');
    this.config = config;
    // Force reload on config change.
    this.svgReady = false;
    this.loadError = undefined;
  }

  getCardSize(): number {
    if (typeof this.config?.height === 'number') return Math.round(this.config.height / 50);
    return 6;
  }

  static getStubConfig(): Partial<FarmScadaCardConfig> {
    return {
      type: 'custom:farm-scada-card',
      source: '/local/farm/greenhouse.svg',
      meta: '/local/farm/greenhouse.meta.json',
    };
  }

  // --- Lifecycle ---

  static styles = css`
    :host { display: block; }
    .host { position: relative; width: 100%; height: var(--farm-scada-height, 480px); }
    .host svg { width: 100%; height: 100%; display: block; }
    .host.hass-disconnected::after {
      content: 'Home Assistant disconnected';
      position: absolute; top: 8px; left: 12px;
      background: var(--error-color, #b91c1c); color: white;
      padding: 2px 8px; border-radius: 4px; font-size: 12px;
    }
    .host.hass-disconnected svg { opacity: 0.5; }
    .menu {
      position: absolute;
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color, #0f172a);
      border: 1px solid var(--divider-color, #e2e8f0);
      border-radius: 6px;
      padding: 4px;
      box-shadow: var(--ha-card-box-shadow, 0 4px 10px rgba(0,0,0,.15));
      z-index: 10;
      min-width: 160px;
    }
    .menu button {
      display: block; width: 100%; text-align: left;
      background: none; border: 0;
      padding: 6px 10px;
      font: inherit; color: inherit;
      cursor: pointer; border-radius: 4px;
    }
    .menu button:hover, .menu button:focus-visible {
      background: var(--secondary-background-color, #f1f5f9);
      outline: none;
    }
    .menu .entity { font-size: 10px; opacity: 0.6; padding: 2px 10px 6px; }
    .error {
      padding: 16px;
      color: var(--error-color, #b91c1c);
      font: 500 13px system-ui;
    }
  `;

  protected firstUpdated(): void {
    void this.loadArtifacts();
  }

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has('hass') && this.svgReady) {
      this.applyHassState();
    }
  }

  disconnectedCallback(): void {
    this.teardownMenu?.();
    this.teardownMenu = null;
    super.disconnectedCallback();
  }

  // --- Loading ---

  private async loadArtifacts(): Promise<void> {
    if (!this.config) return;
    try {
      const cacheBust = `?v=${Date.now()}`;
      const [svgText, metaText] = await Promise.all([
        fetch(this.config.source + cacheBust).then(r => {
          if (!r.ok) throw new Error(`SVG fetch failed: ${r.status}`);
          return r.text();
        }),
        fetch(this.config.meta + cacheBust).then(r => {
          if (!r.ok) throw new Error(`Meta fetch failed: ${r.status}`);
          return r.json() as Promise<HaMeta>;
        }),
      ]);

      if (metaText.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
        throw new Error(
          `farm-scada-card schema mismatch: card supports v${SUPPORTED_SCHEMA_VERSION}, ` +
          `artifact is v${metaText.schemaVersion}. Re-export from the MajiFlow editor or update the card.`,
        );
      }

      this.meta = metaText;
      const host = this.renderRoot.querySelector<HTMLElement>('.host');
      if (!host) throw new Error('card host missing');
      host.innerHTML = svgText;
      const svg = host.querySelector('svg') as SVGSVGElement | null;
      if (!svg) throw new Error('SVG root missing in fetched artifact');
      this.svg = svg;

      // Apply optional viewbox override from card config.
      if (this.config.viewbox) {
        svg.setAttribute('viewBox', this.config.viewbox.join(' '));
      }

      this.indexGroups();
      this.teardownMenu?.();
      this.teardownMenu = installMenuListeners(svg, {
        onMenu: (nodeId, pos) => {
          this.menu = { nodeId, pos: this.toHostPos(pos) };
        },
        onDismiss: () => { this.menu = null; },
      });

      this.svgReady = true;
      this.applyHassState();
    } catch (err) {
      this.loadError = err instanceof Error ? err.message : String(err);
      this.svgReady = false;
    }
  }

  private indexGroups(): void {
    if (!this.svg) return;
    this.nodeGroups.clear();
    this.pipeGroups.clear();
    this.slotEls.clear();
    for (const g of this.svg.querySelectorAll<SVGGElement>('[data-node-id]')) {
      const id = g.getAttribute('data-node-id')!;
      this.nodeGroups.set(id, g);
      const slots = new Map<string, SVGTextElement>();
      for (const t of g.querySelectorAll<SVGTextElement>('text[data-slot]')) {
        slots.set(t.getAttribute('data-slot')!, t);
      }
      this.slotEls.set(id, slots);
    }
    for (const g of this.svg.querySelectorAll<SVGGElement>('[data-pipe-id]')) {
      this.pipeGroups.set(g.getAttribute('data-pipe-id')!, g);
    }
  }

  // Convert viewport coords to coords relative to our host element so the
  // absolutely-positioned menu lands correctly inside the shadow root.
  private toHostPos(pos: MenuPosition): MenuPosition {
    const host = this.renderRoot.querySelector<HTMLElement>('.host');
    if (!host) return pos;
    const rect = host.getBoundingClientRect();
    return { x: pos.x - rect.left, y: pos.y - rect.top };
  }

  // --- Live state application ---

  private applyHassState(): void {
    if (!this.hass || !this.meta) return;
    const hass = this.hass;

    // Disconnection indicator on host.
    const host = this.renderRoot.querySelector<HTMLElement>('.host');
    const connected = hass.connection?.connected !== false;
    host?.classList.toggle('hass-disconnected', !connected);

    // 1) Node state classes + bindings
    for (const [nodeId, node] of Object.entries(this.meta.nodes)) {
      const group = this.nodeGroups.get(nodeId);
      if (!group) continue;

      const stateObj = node.entityId ? hass.states[node.entityId] : undefined;
      const bucket = stateBucket(stateObj?.state);
      applyStateClass(group, bucket);
      // Mark "inert" when node has no mapped entity at all.
      group.classList.toggle('scada-inert', !node.entityId);

      // Resolve binds → update slot text nodes minimally.
      if (node.binds) {
        const slots = this.slotEls.get(nodeId);
        if (slots) {
          for (const [slot, expr] of Object.entries(node.binds)) {
            const el = slots.get(slot);
            if (!el) continue;
            const next = resolveBind(expr, stateObj);
            if (el.textContent !== next) el.textContent = next;
          }
        }
      }

      // Track changed states so future updates can be no-ops when unchanged.
      if (stateObj) this.lastStates.set(node.entityId!, stateObj.state);
    }

    // 2) Pipe flow predicates
    for (const [pipeId, pipe] of Object.entries(this.meta.pipes)) {
      const group = this.pipeGroups.get(pipeId);
      if (!group) continue;
      const active = this.evalFlowWhen(pipe.flowWhen, pipe.fromEntity, hass);
      group.classList.toggle('flow-active', active);
    }
  }

  private evalFlowWhen(flowWhen: string | undefined, fromEntity: string | undefined, hass: HassLike): boolean {
    if (!flowWhen || !fromEntity) return false;
    const m = FLOW_PRED_RE.exec(flowWhen);
    if (!m) return false;
    const expected = m[1];
    const actual = hass.states[fromEntity]?.state;
    return actual === expected;
  }

  // --- Menu actions ---

  private dismissMenu = (): void => {
    this.menu = null;
  };

  private runAction(action: HaActionSpec, entityId: string | undefined): void {
    if (!this.hass) return;
    if (action.confirm && !window.confirm(`${action.label} — are you sure?`)) {
      this.menu = null;
      return;
    }
    if (action.id === 'more-info') {
      if (!entityId) { this.menu = null; return; }
      this.dispatchEvent(new CustomEvent('hass-more-info', {
        detail: { entityId }, bubbles: true, composed: true,
      }));
      this.menu = null;
      return;
    }
    if (!action.service) { this.menu = null; return; }
    const [domain, service] = action.service.split('.');
    if (!domain || !service) { this.menu = null; return; }
    const data: Record<string, unknown> = { ...(action.data ?? {}) };
    if (entityId) data['entity_id'] = entityId;
    void this.hass.callService(domain, service, data);
    this.menu = null;
  }

  // --- Render ---

  render() {
    if (this.loadError) {
      return html`<ha-card .header=${this.config?.title ?? 'SCADA'}><div class="error">${this.loadError}</div></ha-card>`;
    }
    return html`
      <ha-card .header=${this.config?.title ?? nothing}>
        <div class="host" style=${this.hostStyle()}></div>
        ${this.menu ? this.renderMenu() : nothing}
      </ha-card>
    `;
  }

  private hostStyle(): string {
    const h = this.config?.height;
    if (h == null) return '';
    return `--farm-scada-height: ${typeof h === 'number' ? h + 'px' : h};`;
  }

  private renderMenu() {
    if (!this.menu || !this.meta) return nothing;
    const node = this.meta.nodes[this.menu.nodeId];
    const actions = this.resolveActions(node?.entityId, node?.actions);
    const entityId = node?.entityId;
    if (!actions.length) return nothing;

    const style = `left: ${this.menu.pos.x}px; top: ${this.menu.pos.y}px;`;
    return html`
      <div class="menu" style=${style}
           @click=${(e: Event) => e.stopPropagation()}
           role="menu">
        ${entityId ? html`<div class="entity">${entityId}</div>` : nothing}
        ${actions.map(a => html`
          <button role="menuitem" @click=${() => this.runAction(a, entityId)}>${a.label}</button>
        `)}
      </div>
    `;
  }

  private resolveActions(entityId: string | undefined, perNode: HaActionSpec[] | undefined): HaActionSpec[] {
    if (entityId && this.config?.actions_override?.[entityId]?.length) return this.config.actions_override[entityId];
    if (perNode && perNode.length) return perNode;
    return this.config?.default_actions ?? [];
  }
}

// HA card picker registration.
declare global {
  interface Window { customCards?: Array<{ type: string; name: string; description: string }> }
}
window.customCards = window.customCards ?? [];
if (!window.customCards.some(c => c.type === 'farm-scada-card')) {
  window.customCards.push({
    type: 'farm-scada-card',
    name: 'Farm SCADA',
    description: 'Live MajiFlow topology visualization with per-entity menus.',
  });
}
