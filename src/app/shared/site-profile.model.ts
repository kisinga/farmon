import { computed, signal } from '@angular/core';
import {
  VERTICALS, SOURCES, PRIORITIES, CONVEYANCES, MAX_TANKS, MIN_SEVERAL_TANKS, tankLayoutsFor,
  type EasyModeProfile, type Vertical, type SourceKind, type Conveyance, type Priority,
} from '@core';

/**
 * Headless model for the "describe your site" questionnaire shared by the public
 * pricing estimator and the admin quick-setup stepper.
 *
 * It owns the answer state, the catalog-driven option lists, and the derived
 * `EasyModeProfile`, so both surfaces share one source of logic and differ only
 * in their (themed) template and the surrounding flow that consumes `profile()`.
 * Each surface sets its own starting answers and wraps it with its own chrome
 * (the public side adds price + capture; the admin side adds a site name + the
 * board + create). Nothing here branches on which surface is using it: it's a
 * plain class of signals + computeds, so each component just `new`s one and binds
 * its template to these fields.
 */
export class SiteProfileModel {
  // Option lists (catalog SSOT), exposed so templates bind to one place.
  readonly VERTICALS = VERTICALS;
  readonly SOURCES = SOURCES;
  readonly PRIORITIES = PRIORITIES;
  readonly CONVEYANCES = CONVEYANCES;
  readonly MAX_TANKS = MAX_TANKS;

  readonly vertical = signal<Vertical | null>(null);
  readonly sources = signal<Set<SourceKind>>(new Set());
  /** Tank count: null = unanswered, 0 = none, 1 = one, 2+ = several. */
  readonly tanks = signal<number | null>(null);
  /** Chosen multi-tank layout as group sizes, or null for a custom layout. */
  readonly tankGroups = signal<number[] | null>(null);
  readonly zones = signal(1);
  readonly conveyance = signal<Conveyance | null>(null);
  readonly priority = signal<Priority | null>(null);

  readonly isSeveral = computed(() => (this.tanks() ?? 0) >= MIN_SEVERAL_TANKS);
  /** Conveyance matters whenever there is a tank to draw from. */
  readonly showConveyance = computed(() => (this.tanks() ?? 0) >= 1);
  /** The curated layouts for the current tank count. */
  readonly layouts = computed(() => tankLayoutsFor(this.tanks() ?? 0));
  /** Custom layout chosen: several tanks with no preset selected (funnels to a
   *  human design). */
  readonly isCustom = computed(() => this.isSeveral() && this.tankGroups() === null);
  readonly verticalExample = computed(() => VERTICALS.find(o => o.value === this.vertical())?.example ?? null);

  /** The sizing answers as a profile (no site name), or null until sizable: a site
   *  type, at least one source, and the storage question answered. */
  readonly profile = computed<EasyModeProfile | null>(() => {
    const vertical = this.vertical();
    const tanks = this.tanks();
    if (!vertical || tanks === null || this.sources().size === 0) return null;
    return {
      vertical,
      sources: [...this.sources()],
      tanks,
      tankGroups: this.tankGroups() ?? undefined,
      zones: this.zones(),
      conveyance: this.conveyance() ?? undefined,
      priority: this.priority() ?? undefined,
    };
  });

  toggleSource(s: SourceKind): void {
    const next = new Set(this.sources());
    next.has(s) ? next.delete(s) : next.add(s);
    this.sources.set(next);
  }

  /** No storage / one tank: clears any multi-tank layout. */
  setStorage(n: 0 | 1): void {
    this.tanks.set(n);
    this.tankGroups.set(null);
  }

  /** Several: default to two tanks as one bank. */
  setSeveral(): void {
    if (!this.isSeveral()) { this.tanks.set(MIN_SEVERAL_TANKS); this.tankGroups.set([MIN_SEVERAL_TANKS]); }
  }

  /** Step the several count within [MIN, MAX]; reset to one bank for the new count
   *  (the old grouping no longer sums to it). */
  bumpTanks(d: number): void {
    const next = Math.min(this.MAX_TANKS, Math.max(MIN_SEVERAL_TANKS, (this.tanks() ?? MIN_SEVERAL_TANKS) + d));
    this.tanks.set(next);
    this.tankGroups.set([next]);
  }

  bumpZones(d: number): void {
    this.zones.set(Math.max(1, this.zones() + d));
  }

  selectLayout(groups: number[] | null): void {
    this.tankGroups.set(groups);
  }

  isLayout(groups: number[]): boolean {
    return this.tankGroups()?.join(',') === groups.join(',');
  }
}
