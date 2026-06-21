import { Component, OnInit, computed, inject, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  composeEasyMode, estimateSystem, toStoredTopology,
  VERTICALS, SOURCES, PRIORITIES, CONVEYANCES, tankLayoutsFor, MAX_TANKS,
  type EasyModeProfile, type ComposeResult, type SystemEstimate, type Vertical, type SourceKind,
  type Conveyance, type Priority, type BoardDef,
} from '@core';
import { SitesStore } from '../../core/stores/sites.store';
import { BackendService } from '../../core/services/backend.service';
import { BoardService } from '../../core/services/board.service';
import { TopologyPreviewComponent } from '../../shared/topology-preview.component';

/**
 * Easy Mode onboarding stepper. Asks a few plain questions, composes a complete
 * topology with composeEasyMode (pins and all), previews it (with the diagram),
 * then creates the site, saves the topology, and opens the editor. Option copy
 * comes from the shared `@core` catalog so it never drifts from the composer.
 * See docs/development/easy-mode-onboarding-spec.md.
 */
@Component({
  selector: 'app-easy-mode',
  standalone: true,
  imports: [TopologyPreviewComponent],
  host: { class: 'contents' },
  template: `
    <dialog class="modal modal-open">
      <div class="modal-box max-w-2xl">
        <h3 class="font-bold text-lg mb-1">Quick setup</h3>
        <p class="text-sm text-base-content/60 mb-4">A few questions and we build your system, ready to flash.</p>

        @if (boardMissing()) {
          <div class="alert alert-error text-sm mb-3">Couldn't load the controller, so pins can't be wired. Reload and try again.</div>
        }

        @if (!boardReady()) {
          <div class="flex items-center justify-center py-10"><span class="loading loading-spinner text-cyan-400"></span></div>
        } @else if (phase() === 'answer') {
          <div class="space-y-5">
            <div>
              <label class="label-text font-medium">Site name</label>
              <input type="text" class="input input-bordered w-full mt-1" placeholder="e.g. Riverside Farm"
                [value]="name()" (input)="name.set($any($event.target).value)" />
            </div>

            <div>
              <div class="label-text font-medium mb-1.5">What kind of site is this?</div>
              <div class="flex flex-wrap gap-1.5">
                @for (o of VERTICALS; track o.value) {
                  <button [class]="pill(vertical() === o.value)" (click)="vertical.set(o.value)">{{ o.label }}</button>
                }
              </div>
              @if (verticalExample(); as ex) { <p class="text-xs text-base-content/50 mt-1">e.g. {{ ex }}</p> }
            </div>

            <div>
              <div class="label-text font-medium mb-1.5">Where does your water come from? <span class="opacity-50">(pick all)</span></div>
              <div class="flex flex-wrap gap-1.5">
                @for (o of SOURCES; track o.value) {
                  <button [class]="pill(sources().has(o.value))" (click)="toggleSource(o.value)">{{ o.label }}</button>
                }
              </div>
              @if (sources().size > 1) { <p class="text-xs text-base-content/50 mt-1">We'll fill one shared tank from these.</p> }
            </div>

            <div>
              <div class="label-text font-medium mb-1.5">Do you store water on site?</div>
              <div class="flex flex-wrap gap-1.5">
                <button [class]="pill(tanks() === 0)" (click)="tanks.set(0)">No</button>
                <button [class]="pill(tanks() === 1)" (click)="tanks.set(1)">One tank</button>
                <button [class]="pill(isSeveral())" (click)="setSeveral()">Several</button>
              </div>
              @if (isSeveral()) {
                <div class="mt-2 rounded-lg bg-base-200/60 p-3 space-y-3">
                  <div class="flex items-center gap-2">
                    <span class="text-sm">How many tanks?</span>
                    <button class="btn btn-xs btn-square" (click)="bumpTanks(-1)" [disabled]="(tanks() ?? 2) <= 2">−</button>
                    <span class="font-mono w-6 text-center">{{ tanks() }}</span>
                    <button class="btn btn-xs btn-square" (click)="bumpTanks(1)" [disabled]="(tanks() ?? 2) >= MAX_TANKS">+</button>
                  </div>
                  <div>
                    <div class="text-sm mb-1.5">How are they arranged?</div>
                    <div class="flex flex-wrap gap-1.5">
                      @for (o of layouts(); track o.label) {
                        <button [class]="pill(isLayout(o.groups))" (click)="selectLayout(o.groups)">{{ o.label }}</button>
                      }
                      <button [class]="pill(isCustom())" (click)="selectLayout(null)">Something else</button>
                    </div>
                    @if (isCustom()) { <p class="text-xs text-base-content/50 mt-1">We'll place the tanks and open the editor for you to lay them out.</p> }
                  </div>
                </div>
              }
            </div>

            <div>
              <div class="label-text font-medium mb-1.5">How many areas are turned on/off separately?</div>
              <div class="flex items-center gap-2">
                <button class="btn btn-sm btn-square" (click)="bumpZones(-1)" [disabled]="zones() <= 1">−</button>
                <span class="font-mono text-lg w-8 text-center">{{ zones() }}</span>
                <button class="btn btn-sm btn-square" (click)="bumpZones(1)">+</button>
                <span class="text-xs text-base-content/50 ml-2">each gets its own valve</span>
              </div>
              @if (zones() > 7) { <p class="text-xs text-warning mt-1">More than seven needs a bigger setup; we'll open the editor.</p> }
            </div>

            @if (showConveyance()) {
              <div>
                <div class="label-text font-medium mb-1.5">Does the water need a pump to reach where it's used?</div>
                <div class="text-xs text-base-content/50 mb-1.5">For example it travels far, runs uphill, or needs more pressure than the tank gives on its own.</div>
                <div class="flex flex-wrap gap-1.5">
                  @for (o of CONVEYANCES; track o.value) {
                    <button [class]="pill(conveyance() === o.value)" (click)="conveyance.set(o.value)">{{ o.label }}</button>
                  }
                </div>
              </div>
            }

            <div>
              <div class="label-text font-medium mb-1.5">What worries you most? <span class="opacity-50">(optional)</span></div>
              <div class="flex flex-wrap gap-1.5">
                @for (o of PRIORITIES; track o.value) {
                  <button [class]="pill(priority() === o.value)" (click)="priority.set(o.value)">{{ o.label }}</button>
                }
              </div>
            </div>
          </div>

          <!-- Live controller budget: recomputed from the same composer as you answer. -->
          @if (liveEstimate(); as e) {
            <div class="mt-4 rounded-lg bg-base-200/60 px-3 py-2 text-xs flex items-center gap-3 flex-wrap">
              <span class="font-medium">Controller use</span>
              <span class="font-mono">{{ e.budget.relays }}/{{ e.limits.relays }} relays</span>
              <span class="font-mono">{{ e.budget.analog }}/{{ e.limits.analog }} analog</span>
              <span class="font-mono">{{ e.budget.pulse }}/{{ e.limits.pulse }} pulse</span>
              @if (e.fits) {
                <span class="text-success ml-auto">Fits one controller</span>
              } @else {
                <span class="text-warning ml-auto">Needs a bigger setup</span>
              }
            </div>
          }

          @if (formError()) {
            <div class="alert alert-warning text-sm mt-4">{{ formError() }}</div>
          }
          <div class="modal-action">
            <button class="btn btn-ghost" (click)="close.emit()">Cancel</button>
            <button class="btn border-0 bg-cyan-400 text-slate-950 hover:bg-cyan-300" (click)="preview()">
              Build my system
            </button>
          </div>
        } @else if (result(); as r) {
          <div class="space-y-4">
            <!-- The diagram leads: the design at a glance before the detail. -->
            @if (r.topology) {
              <app-topology-preview [topology]="r.topology" />
            }

            @if (handoffCopy(); as h) {
              <div class="alert alert-warning text-sm">{{ r.notes[r.notes.length - 1] }}</div>
              <p class="text-sm font-medium">{{ h.title }}</p>
              <p class="text-sm text-base-content/70">{{ h.body }}</p>
            } @else {
              <div class="rounded-xl bg-base-200 p-4 space-y-2">
                <div class="text-sm font-medium">Here's what we'll build</div>
                <div class="flex flex-wrap gap-2 text-xs">
                  @for (c of nodeSummary(); track c.label) {
                    <span class="badge badge-ghost">{{ c.count }} {{ c.label }}</span>
                  }
                </div>
                <div class="grid grid-cols-3 gap-2 text-xs mt-2">
                  <div>Relays <span class="font-mono">{{ r.budget.relays }}/{{ limits().relays }}</span></div>
                  <div>Analog <span class="font-mono">{{ r.budget.analog }}/{{ limits().analog }}</span></div>
                  <div>Pulse <span class="font-mono">{{ r.budget.pulse }}/{{ limits().pulse }}</span></div>
                </div>
              </div>
              @if (wiring().length) {
                <div class="rounded-xl bg-base-200 p-4 space-y-1">
                  <div class="text-sm font-medium mb-1">Wiring (auto-assigned)</div>
                  @for (w of wiring(); track w.name) {
                    <div class="flex justify-between gap-3 text-xs"><span class="truncate">{{ w.name }}</span><span class="font-mono shrink-0">{{ w.pins }}</span></div>
                  }
                </div>
              }
              @if (boardMissing()) {
                <p class="text-xs text-warning">Preview only: the exact pins are assigned when you open the editor.</p>
              }
              @if (r.notes.length) {
                <ul class="text-xs text-base-content/60 list-disc pl-5 space-y-1">
                  @for (n of r.notes; track n) { <li>{{ n }}</li> }
                </ul>
              }
            }
          </div>

          @if (formError()) {
            <div class="alert alert-warning text-sm mt-4">{{ formError() }}</div>
          }
          <div class="modal-action">
            <button class="btn btn-ghost" (click)="phase.set('answer')">Back</button>
            @if (handoffCopy()?.contact) {
              <a class="btn btn-ghost" href="/pricing" target="_blank" rel="noopener">Talk to our setup team</a>
            }
            <button class="btn border-0 bg-cyan-400 text-slate-950 hover:bg-cyan-300" [disabled]="creating()" (click)="create()">
              @if (creating()) { <span class="loading loading-spinner loading-xs"></span> }
              {{ handoffCopy() ? 'Create and open editor' : 'Create my site' }}
            </button>
          </div>
        }
      </div>
      <div class="modal-backdrop" (click)="close.emit()"></div>
    </dialog>
  `,
})
export class EasyModeComponent implements OnInit {
  readonly close = output<void>();

  private sitesStore = inject(SitesStore);
  private backend = inject(BackendService);
  private boards = inject(BoardService);
  private router = inject(Router);

  // Option copy + answer sets come from the shared catalog (one source of truth).
  protected readonly VERTICALS = VERTICALS;
  protected readonly SOURCES = SOURCES;
  protected readonly PRIORITIES = PRIORITIES;
  protected readonly CONVEYANCES = CONVEYANCES;
  protected readonly MAX_TANKS = MAX_TANKS;

  protected board = signal<BoardDef | null>(null);
  protected boardModel = signal<string | null>(null);
  protected boardReady = signal(false);
  protected boardMissing = signal(false);
  protected phase = signal<'answer' | 'preview'>('answer');
  protected creating = signal(false);
  protected result = signal<ComposeResult | null>(null);
  protected formError = signal<string | null>(null);

  protected name = signal('');
  protected vertical = signal<Vertical | null>(null);
  protected sources = signal<Set<SourceKind>>(new Set());
  /** Tank count: 0 = none, 1 = one, 2+ = several (laid out per tankGroups). */
  protected tanks = signal<number | null>(null);
  /** Chosen layout as group sizes, or null for a custom layout (handed to the
   *  canvas). Only meaningful when several. */
  protected tankGroups = signal<number[] | null>(null);
  protected zones = signal(1);
  protected conveyance = signal<Conveyance | null>(null);
  protected priority = signal<Priority | null>(null);

  /** Several = two or more tanks (reveals the count + layout sub-questions). */
  protected readonly isSeveral = computed(() => (this.tanks() ?? 0) >= 2);
  /** Conveyance matters whenever there is a tank to draw from (one or several). */
  protected readonly showConveyance = computed(() => (this.tanks() ?? 0) >= 1);
  /** The curated layouts for the current tank count. */
  protected readonly layouts = computed(() => tankLayoutsFor(this.tanks() ?? 0));
  /** Custom layout chosen: several tanks with no preset selected. */
  protected readonly isCustom = computed(() => this.isSeveral() && this.tankGroups() === null);

  /** Whether the given preset is the current selection. */
  protected isLayout(groups: number[]): boolean {
    return this.tankGroups()?.join(',') === groups.join(',');
  }
  protected selectLayout(groups: number[] | null): void {
    this.tankGroups.set(groups);
  }

  private missingFields(): string[] {
    const m: string[] = [];
    if (!this.name().trim()) m.push('a site name');
    if (this.vertical() === null) m.push('the site type');
    if (this.sources().size === 0) m.push('a water source');
    if (this.tanks() === null) m.push('whether you store water');
    if (this.zones() < 1) m.push('the number of areas');
    if (this.showConveyance() && this.conveyance() === null) m.push('whether the water needs a pump');
    return m;
  }

  /** Pick "Several": default to two tanks as one bank. */
  protected setSeveral(): void {
    if (!this.isSeveral()) { this.tanks.set(2); this.tankGroups.set([2]); }
  }
  /** Step the tank count within [2, MAX_TANKS]; reset the layout to one bank for
   *  the new count (the old grouping no longer sums to it). */
  protected bumpTanks(d: number): void {
    const next = Math.min(this.MAX_TANKS, Math.max(2, (this.tanks() ?? 2) + d));
    this.tanks.set(next);
    this.tankGroups.set([next]);
  }

  /** Board pin limits, taken from the live estimate (one source). A defensive
   *  fallback to the Easy Mode board's known caps covers the moment before the
   *  estimate exists, so the preview never shows a bare number. */
  protected readonly limits = computed(() =>
    this.liveEstimate()?.limits ?? { relays: 16, analog: 4, pulse: 3 },
  );

  /** One cyan accent for every selected option pill, matching the primary CTA. */
  protected pill(active: boolean): string {
    return active
      ? 'btn btn-sm border-0 bg-cyan-400 text-slate-950 hover:bg-cyan-300'
      : 'btn btn-sm btn-ghost border border-base-300';
  }

  /** One-line example for the selected site type (from the catalog). */
  protected verticalExample = computed(() => VERTICALS.find(o => o.value === this.vertical())?.example ?? null);

  /** Live hardware estimate, recomputed from the sizing answers as they change.
   *  Uses the sizing-only profile so it does not re-run on every site-name
   *  keystroke (the name never affects the budget). Null until sizable. */
  protected liveEstimate = computed<SystemEstimate | null>(() => {
    const p = this.sizingProfile();
    if (!p) return null;
    try { return estimateSystem(p); } catch { return null; }
  });

  /** Distinct copy + destination per handoff; null on the normal (no-handoff) path. */
  protected handoffCopy = computed(() => {
    switch (this.result()?.handoff) {
      case 'expert':
        return { title: 'Finish in the editor', contact: false,
          body: "This design needs a touch we can't make automatically. We'll create the site and open the editor so you can complete it." };
      case 'setup_service':
        return { title: 'Bigger than one controller', contact: true,
          body: "This is more than one controller can drive. We'll open the editor so you can keep going, and our team can help you wire the rest." };
      default:
        return null;
    }
  });

  /** Auto-assigned pins per actuator/sensor, shown in the preview so wiring is visible before creating. */
  protected wiring = computed(() => {
    const out: { name: string; pins: string }[] = [];
    for (const n of this.result()?.topology?.nodes ?? []) {
      const rec = n as Record<string, unknown>;
      const name = (rec['name'] as string) ?? n.id;
      if (n.kind === 'pump' && rec['pin']) out.push({ name, pins: rec['pin'] as string });
      else if (n.kind === 'valve' && (rec['open_pin'] || rec['close_pin'])) out.push({ name, pins: `${rec['open_pin'] ?? '?'} / ${rec['close_pin'] ?? '?'}` });
      else if (n.kind === 'flow_sensor' && rec['pin']) out.push({ name, pins: rec['pin'] as string });
      else if (n.kind === 'tank' && rec['pressure_pin']) out.push({ name, pins: rec['pressure_pin'] as string });
    }
    return out;
  });

  protected nodeSummary = computed(() => {
    const counts: Record<string, number> = {};
    for (const n of this.result()?.topology?.nodes ?? []) counts[n.kind] = (counts[n.kind] ?? 0) + 1;
    const label: Record<string, string> = {
      water_source: 'source', pump: 'pump', tank: 'tank', valve: 'valve',
      flow_sensor: 'flow meter', endpoint: 'area',
    };
    return Object.entries(counts).map(([k, count]) => ({ count, label: (label[k] ?? k) + (count > 1 ? 's' : '') }));
  });

  async ngOnInit() {
    try {
      // One shared resolver (also used by lead conversion) so both wire against
      // the same controller; tolerates the seeded model id variants.
      const resolved = await this.boards.loadEasyModeBoard();
      if (!resolved) { this.boardMissing.set(true); return; }
      this.boardModel.set(resolved.model);
      this.board.set(resolved.board);
    } catch {
      this.boardMissing.set(true);
    } finally {
      this.boardReady.set(true);
    }
  }

  protected toggleSource(s: SourceKind) {
    const next = new Set(this.sources());
    next.has(s) ? next.delete(s) : next.add(s);
    this.sources.set(next);
  }

  protected bumpZones(d: number) {
    this.zones.set(Math.max(1, this.zones() + d));
  }

  /** The sizing answers (everything the budget depends on), no friendlyName, so
   *  the live estimate doesn't recompute on site-name keystrokes. */
  private sizingProfile(): EasyModeProfile | null {
    const v = this.vertical();
    const t = this.tanks();
    if (!v || t === null || this.sources().size === 0) return null;
    return {
      vertical: v,
      sources: [...this.sources()],
      tanks: t,
      tankGroups: this.tankGroups() ?? undefined,
      zones: this.zones(),
      conveyance: this.conveyance() ?? undefined,
      priority: this.priority() ?? undefined,
    };
  }

  /** The full profile (sizing + the site name) used to build the saved topology. */
  private profile(): EasyModeProfile | null {
    const p = this.sizingProfile();
    return p ? { ...p, friendlyName: this.name().trim() } : null;
  }

  protected preview() {
    this.formError.set(null);
    const missing = this.missingFields();
    if (missing.length) {
      this.formError.set('Please answer ' + missing.join(', ') + '.');
      return;
    }
    const p = this.profile();
    if (!p) { this.formError.set('Please complete the form.'); return; }
    try {
      // Mint a globally-unique controller id (the provision identity); the default
      // 'controller1' would collide across Easy Mode sites at deploy time.
      const controllerId = this.backend.newControllerId(this.name().trim());
      this.result.set(composeEasyMode(p, this.board() ?? undefined, this.boardModel() ?? undefined, controllerId));
      this.phase.set('preview');
    } catch (e) {
      this.formError.set(e instanceof Error ? e.message : 'Could not build the system.');
    }
  }

  protected async create() {
    const r = this.result();
    const name = this.name().trim();
    if (!name) return;
    // Never persist an unwired site: pins come from the board. Estimation mode
    // (no board) is preview-only; creation requires the controller.
    if (!this.board()) { this.formError.set("Couldn't load the controller, so pins can't be wired. Reload and try again."); return; }
    this.creating.set(true);
    this.formError.set(null);
    try {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const { id } = await this.sitesStore.create(slug, name);
      if (r?.topology) {
        await this.backend.siteSave({ site: { id, friendlyName: name }, topology: toStoredTopology(r.topology) });
      }
      this.close.emit();
      this.router.navigate(['/site', id]);
    } catch (e) {
      // Surface the failure instead of stranding the user on a stuck spinner.
      this.formError.set(e instanceof Error ? e.message : 'Could not create the site. Please try again.');
    } finally {
      this.creating.set(false);
    }
  }
}
