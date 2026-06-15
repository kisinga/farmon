import { Component, computed, inject, input, signal } from '@angular/core';
import { deriveTankCalibration, tankCalibrationToPhysical, type CalibrationControl, type CommandPhase } from '@core';
import { DashboardStore } from '../dashboard.store';
import { CommandLifecycleStore } from '../command-lifecycle.store';
import { ConfirmService } from '../../../core/services/confirm.service';

/** Tolerance (psi) for calling the physical model and the device "in sync". */
const SYNC_TOL = 0.05;

/**
 * TankCalibrationComponent — calibrate a tank's pressure sensor in the *physical*
 * terms the topology designer used (tank height, sensor drop), not raw psi.
 *
 * The physical inputs are a lens over the device's psi anchors: editing them
 * derives `cal_empty`/`cal_full` (deriveTankCalibration), which Save writes via
 * config_set behind a hard confirm. The device's actual anchors + live level are
 * shown for comparison; "Match device" pulls the physical model back from the
 * device's current calibration (the inverse) so a raw/out-of-band change reconciles.
 * Physical params are never written back to the topology.
 */
@Component({
  selector: 'app-tank-calibration',
  standalone: true,
  template: `
    <div class="rounded-xl ring-1 ring-base-300/40 bg-base-100/40 p-3 flex flex-col gap-3">
      <div class="flex items-center gap-2">
        <span class="text-sm font-semibold truncate">{{ cal().nodeName }}</span>
        <span class="grow"></span>
        @if (level() !== null) {
          <span class="text-xs text-base-content/50">Live level <span class="font-semibold tabular-nums text-primary">{{ level() }}%</span></span>
        }
      </div>

      <!-- Physical model (the designer's inputs) -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-x-3 gap-y-2">
        <label class="flex flex-col gap-0.5">
          <span class="text-[11px] text-base-content/60">Tank height (m)</span>
          <input type="number" min="0" step="0.05" class="input input-sm input-bordered"
            [value]="height()" [disabled]="!canEdit()" (input)="edit('height', $event)" />
        </label>
        <label class="flex flex-col gap-0.5">
          <span class="text-[11px] text-base-content/60" title="Vertical drop from tank outlet down to the sensor — stays full of water, shifts the empty reading.">Sensor drop below tank (m)</span>
          <input type="number" min="0" step="0.05" class="input input-sm input-bordered"
            [value]="drop()" [disabled]="!canEdit()" (input)="edit('drop', $event)" />
        </label>
        <label class="flex flex-col gap-0.5">
          <span class="text-[11px] text-base-content/60">Sensor max (psi)</span>
          <input type="number" min="0" step="0.5" class="input input-sm input-bordered"
            [value]="maxPsi()" [disabled]="!canEdit()" (input)="edit('maxPsi', $event)" />
        </label>
      </div>

      <!-- Derived ↔ device -->
      <div class="text-[11px] text-base-content/50 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>Implies: empty <span class="font-mono text-base-content/70">{{ derived().p_empty_psi.toFixed(2) }}</span> · full <span class="font-mono text-base-content/70">{{ derived().p_full_psi.toFixed(2) }}</span> psi</span>
        @if (deviceEmpty() !== null && deviceFull() !== null) {
          <span>Device now: empty <span class="font-mono text-base-content/70">{{ deviceEmpty()!.toFixed(2) }}</span> · full <span class="font-mono text-base-content/70">{{ deviceFull()!.toFixed(2) }}</span> psi</span>
        }
      </div>

      @if (!valid()) {
        <p class="text-[11px] text-error">{{ validationMsg() }}</p>
      } @else if (diverged()) {
        <p class="text-[11px] text-warning">The device's current calibration differs from this physical model.</p>
      }

      @if (canEdit()) {
        <div class="flex items-center gap-2">
          <button class="btn btn-sm btn-primary gap-1" [disabled]="!dirty() || !valid() || saving()" (click)="save()">
            @if (saving()) { <span class="loading loading-spinner loading-xs"></span> }
            Save calibration
          </button>
          @if (diverged()) {
            <button class="btn btn-sm btn-ghost" (click)="matchDevice()">Match device</button>
          }
          @if (phase(); as ph) {
            @switch (ph.phase) {
              @case ('confirmed') { <span class="text-xs text-success">✓ Applied</span> }
              @case ('refused') { <span class="text-xs text-error">{{ ph.reason || 'rejected' }}</span> }
              @case ('expired') { <span class="text-xs text-warning">No confirmation</span> }
              @default {}
            }
          }
        </div>
      }
    </div>
  `,
})
export class TankCalibrationComponent {
  readonly cal = input.required<CalibrationControl>();
  readonly controller = input.required<string>();
  readonly canEdit = input(true);

  private store = inject(DashboardStore);
  private lifecycle = inject(CommandLifecycleStore);
  private confirm = inject(ConfirmService);

  /** Physical edits overlaying the topology design values. */
  private edits = signal<{ height?: number; drop?: number; maxPsi?: number }>({});
  protected saving = signal(false);

  protected height = computed(() => this.edits().height ?? this.cal().tankHeightM);
  protected drop = computed(() => this.edits().drop ?? this.cal().sensorDropM);
  protected maxPsi = computed(() => this.edits().maxPsi ?? this.cal().sensorMaxPsi);
  protected dirty = computed(() => Object.keys(this.edits()).length > 0);

  /** psi anchors implied by the current physical inputs. */
  protected derived = computed(() => deriveTankCalibration(this.height(), this.drop()));

  private deviceVal(key: string): number | null {
    const r = this.store.row(this.controller(), key);
    return r && Number.isFinite(r.reported) ? r.reported : null;
  }
  protected deviceEmpty = computed(() => this.deviceVal(this.cal().calEmptyKey));
  protected deviceFull = computed(() => this.deviceVal(this.cal().calFullKey));
  protected level = computed(() => {
    const r = this.store.row(this.controller(), this.cal().levelSensor);
    return r && Number.isFinite(r.reported) ? Math.round(r.reported) : null;
  });

  protected valid = computed(() => {
    const d = this.derived();
    return this.height() > 0 && d.p_empty_psi < d.p_full_psi && d.p_full_psi <= this.maxPsi() + 0.001;
  });
  protected validationMsg = computed(() => {
    const d = this.derived();
    if (this.height() <= 0) return 'Tank height must be greater than 0.';
    if (d.p_empty_psi >= d.p_full_psi) return 'Empty pressure must be below full — check the drop and height.';
    if (d.p_full_psi > this.maxPsi() + 0.001) return `Full pressure (${d.p_full_psi.toFixed(1)} psi) exceeds the sensor's max (${this.maxPsi()} psi).`;
    return '';
  });

  /** Diverged when the device reports anchors that differ from the physical model. */
  protected diverged = computed(() => {
    const de = this.deviceEmpty(), df = this.deviceFull();
    if (de === null || df === null) return false;
    const d = this.derived();
    return Math.abs(de - d.p_empty_psi) > SYNC_TOL || Math.abs(df - d.p_full_psi) > SYNC_TOL;
  });

  /** Aggregate command phase across the calibration's keys (for the status line). */
  protected phase = computed<{ phase: CommandPhase; reason: string } | null>(() => {
    const c = this.controller(), cal = this.cal();
    for (const key of [cal.calEmptyKey, cal.calFullKey, cal.rangeMaxKey, cal.rangeMinKey]) {
      const p = this.lifecycle.phaseFor(`${c}/cfg/${key}`);
      if (p) return p;
    }
    return null;
  });

  protected edit(field: 'height' | 'drop' | 'maxPsi', ev: Event): void {
    const v = (ev.target as HTMLInputElement).value;
    this.edits.update((e) => {
      const n = { ...e };
      if (v === '') delete n[field]; else n[field] = Number(v);
      return n;
    });
  }

  /** Pull the physical model from the device's current anchors (the inverse). */
  protected matchDevice(): void {
    const de = this.deviceEmpty(), df = this.deviceFull();
    if (de === null || df === null) return;
    const phys = tankCalibrationToPhysical(de, df);
    this.edits.set({ height: round2(phys.tank_height_m), drop: round2(phys.elevation_m) });
  }

  /** Write the derived anchors (+ sensor range) via config_set, behind a hard confirm. */
  protected async save(): Promise<void> {
    if (!this.canEdit() || !this.dirty() || !this.valid()) return;
    const ok = await this.confirm.confirm({
      title: `Re-calibrate ${this.cal().nodeName}?`,
      message: `This changes how the tank's level is computed from its pressure sensor. Level-based safety gates (source-low / tank-full) depend on it — set it only from a known measurement.`,
      confirmLabel: 'Apply calibration',
      variant: 'error',
    });
    if (!ok) return;
    this.saving.set(true);
    try {
      const cal = this.cal(), c = this.controller(), d = this.derived();
      const write = (key: string, value: number) =>
        this.lifecycle.dispatch(`${c}/cfg/${key}`, c, 'config_set', { configKey: key, value: round2(value) });
      await Promise.all([
        write(cal.calEmptyKey, d.p_empty_psi),
        write(cal.calFullKey, d.p_full_psi),
        write(cal.rangeMaxKey, this.maxPsi()),
      ]);
      this.edits.set({}); // device now drives the display; convergence shows via phase
    } finally {
      this.saving.set(false);
    }
  }
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
