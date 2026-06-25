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
 * derives `cal_empty`/`cal_full` (deriveTankCalibration), which Save writes as desired
 * config into the server-owned `controller_config` (one upsert, behind a hard confirm
 * — config_set is gone; the server republishes the retained /config and the device
 * applies it). The device's actual anchors + live level are
 * shown for comparison; "Match device" pulls the physical model back from the
 * device's current calibration (the inverse) so a raw/out-of-band change reconciles.
 * Physical params are never written back to the topology.
 */
@Component({
  selector: 'app-tank-calibration',
  standalone: true,
  template: `
    <div class="rounded-xl ring-1 ring-base-300/40 bg-base-100/40 p-3.5 flex flex-col gap-3.5">
      <div class="flex items-center gap-2">
        <span class="text-sm font-semibold truncate">{{ cal().nodeName }}</span>
        <span class="grow"></span>
        @if (level() !== null || pressurePsi() !== null) {
          <span class="inline-flex items-baseline gap-1.5 text-xs text-base-content/50">
            <span>Live</span>
            @if (level() !== null) {
              <span class="font-semibold tabular-nums text-primary text-sm">{{ level() }}%</span>
            }
            @if (level() !== null && pressurePsi() !== null) { <span class="text-base-content/25">·</span> }
            @if (pressurePsi() !== null) {
              <span class="font-semibold tabular-nums text-primary text-sm">{{ pressurePsi()!.toFixed(2) }} <span class="text-[11px] font-normal text-base-content/40">psi</span></span>
            }
          </span>
        }
      </div>

      <!-- The physical model, shown not just told: a tank with the sensor dropped
           below it, paired with the three measurements that define it. The schematic
           fills to the live level so the numbers map to something real. -->
      <div class="flex gap-4">
        <svg viewBox="0 0 72 104" class="shrink-0 w-17 h-25 text-base-content/35" fill="none" stroke="currentColor">
          <!-- height + drop dimension rails (left) -->
          <g stroke-width="1" stroke-linecap="round" class="text-base-content/25">
            <line x1="20" y1="8" x2="20" y2="66" /><line x1="17" y1="8" x2="23" y2="8" /><line x1="17" y1="66" x2="23" y2="66" />
            <line x1="20" y1="66" x2="20" y2="90" /><line x1="17" y1="90" x2="23" y2="90" />
          </g>
          <text x="10" y="40" font-size="9" fill="currentColor" stroke="none" class="text-base-content/45">h</text>
          <text x="10" y="81" font-size="9" fill="currentColor" stroke="none" class="text-base-content/45">d</text>
          <!-- water fill (to live level), then tank outline over it -->
          <clipPath id="tank-{{ cal().nodeId }}"><rect x="31" y="9" width="28" height="56" rx="2.5" /></clipPath>
          <rect [attr.x]="31" [attr.y]="63 - 54 * waterFrac()" width="28" [attr.height]="54 * waterFrac()"
            stroke="none" class="fill-primary/35" [attr.clip-path]="'url(#tank-' + cal().nodeId + ')'" />
          <rect x="31" y="9" width="28" height="56" rx="2.5" stroke-width="1.6" />
          <!-- sensor on a drop pipe below the tank -->
          <line x1="45" y1="65" x2="45" y2="89" stroke-width="2" />
          <rect x="39" y="89" width="12" height="8" rx="1.5" stroke-width="1.4" class="fill-base-200" />
        </svg>

        <div class="flex-1 grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2.5 content-center">
          <label [attr.for]="'h-' + cal().nodeId" class="text-[11px] text-base-content/70">Tank height</label>
          <span class="flex items-center gap-1.5">
            <input [id]="'h-' + cal().nodeId" type="number" min="0" step="0.05" class="input input-sm input-bordered w-20 text-right tabular-nums no-spin"
              [value]="height()" [disabled]="!canEdit()" (input)="edit('height', $event)" />
            <span class="text-[11px] text-base-content/40 w-7">m</span>
          </span>

          <label [attr.for]="'d-' + cal().nodeId" class="text-[11px] text-base-content/70 cursor-help"
            title="Vertical drop from the tank outlet down to the sensor — this column stays full of water and offsets the empty reading.">Sensor drop</label>
          <span class="flex items-center gap-1.5">
            <input [id]="'d-' + cal().nodeId" type="number" min="0" step="0.05" class="input input-sm input-bordered w-20 text-right tabular-nums no-spin"
              [value]="drop()" [disabled]="!canEdit()" (input)="edit('drop', $event)" />
            <span class="text-[11px] text-base-content/40 w-7">m</span>
          </span>

          <span class="text-[11px] text-base-content/70 cursor-help"
            title="Sensor full-scale rating (datasheet). Baked into the firmware — change it in the editor and re-flash, not here.">Sensor max</span>
          <span class="flex items-center gap-1.5">
            <span class="w-20 text-right tabular-nums text-sm text-base-content/60">{{ maxPsi() }}</span>
            <span class="text-[11px] text-base-content/40 w-7">psi</span>
          </span>
        </div>
      </div>

      <!-- The model as a picture: the empty→full range (neutral) inside the sensor's
           0…max, the live pressure riding it in the same cyan as the Live readout (so
           cyan = "now" everywhere), and, while you have unsaved edits, the device's
           current anchors in amber so you can see what Save will change. -->
      <div class="flex flex-col gap-1.5">
        <div class="relative h-2.5 rounded-full bg-base-200">
          <div class="absolute inset-y-0 rounded-full transition-all" [class]="valid() ? 'bg-base-content/20' : 'bg-error/30'"
            [style.left.%]="pct(derived().p_empty_psi)" [style.right.%]="100 - pct(derived().p_full_psi)"></div>
          <div class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-0.75 h-4 rounded-full" [class]="valid() ? 'bg-base-content/45' : 'bg-error'" [style.left.%]="pct(derived().p_empty_psi)"></div>
          <div class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-0.75 h-4 rounded-full" [class]="valid() ? 'bg-base-content/45' : 'bg-error'" [style.left.%]="pct(derived().p_full_psi)"></div>
          @if (diverged()) {
            <div class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-0.5 h-4 bg-warning/80" [style.left.%]="pct(deviceEmpty()!)"></div>
            <div class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-0.5 h-4 bg-warning/80" [style.left.%]="pct(deviceFull()!)"></div>
          }
          @if (pressurePsi() !== null) {
            <div class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-primary ring-2 ring-base-100 shadow transition-all" [style.left.%]="pct(pressurePsi()!)"></div>
          }
        </div>
        <div class="flex items-center justify-between text-[10px] text-base-content/45 tabular-nums">
          <span>0</span>
          <span [class]="valid() ? 'text-base-content/55' : 'text-error'">
            empty <span class="font-semibold">{{ derived().p_empty_psi.toFixed(2) }}</span> · full <span class="font-semibold">{{ derived().p_full_psi.toFixed(2) }}</span> psi
          </span>
          <span>{{ maxPsi() }}</span>
        </div>
      </div>

      @if (!valid()) {
        <p class="text-[11px] text-error">{{ validationMsg() }}</p>
      } @else if (diverged()) {
        <p class="text-[11px] text-warning flex items-center gap-1.5">
          <span class="w-2 h-0.5 bg-warning/80 shrink-0"></span>
          Unsaved change. The device still reads empty {{ deviceEmpty()!.toFixed(2) }} · full {{ deviceFull()!.toFixed(2) }} psi until you save.
        </p>
      }

      @if (canEdit()) {
        <div class="flex items-center gap-2">
          <button class="btn btn-sm btn-primary gap-1" [disabled]="!dirty() || !valid() || saving()" (click)="save()">
            @if (saving()) { <span class="loading loading-spinner loading-xs"></span> }
            Save calibration
          </button>
          @if (dirty()) {
            <button class="btn btn-sm btn-ghost" (click)="discard()">Discard</button>
          }
          @if (phase(); as ph) {
            @switch (ph.phase) {
              @case ('confirmed') { <span class="text-xs text-success">✓ Applied</span> }
              @case ('refused') { <span class="text-xs text-error">{{ ph.reason || 'rejected' }}</span> }
              @case ('expired') { <span class="text-xs text-warning">No confirmation</span> }
              @default {}
            }
          }
          <span class="grow"></span>
          <button class="btn btn-xs btn-ghost text-base-content/50" (click)="loadDesign()"
            title="Fill the fields from the topology design values">Use design values</button>
        </div>
      }
    </div>
  `,
  styles: [`
    /* Quiet number inputs: the native spinners clutter a calibration grid and the
       value is set deliberately, not nudged. */
    .no-spin::-webkit-outer-spin-button, .no-spin::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    .no-spin { -moz-appearance: textfield; appearance: textfield; }
  `],
})
export class TankCalibrationComponent {
  readonly cal = input.required<CalibrationControl>();
  readonly controller = input.required<string>();
  readonly canEdit = input(true);

  private store = inject(DashboardStore);
  private lifecycle = inject(CommandLifecycleStore);
  private confirm = inject(ConfirmService);

  /** Physical edits overlaying the topology design values. Sensor max is a baked
   *  spec, not a field edit, so it never appears here. */
  private edits = signal<{ height?: number; drop?: number }>({});
  protected saving = signal(false);

  /** The physical model the editor sits on when there are no edits: the device's
   *  live calibration (its psi anchors run back through the inverse), falling back
   *  to the topology design only until the device reports. The device is the source
   *  of truth for the *current* calibration, so after a save the model tracks what
   *  was written and the divergence clears; topology is just the initial seed. */
  protected baseline = computed<{ height: number; drop: number; maxPsi: number }>(() => {
    const cal = this.cal();
    const maxPsi = cal.sensorMaxPsi;
    const de = this.deviceEmpty(), df = this.deviceFull();
    if (de === null || df === null) return { height: cal.tankHeightM, drop: cal.sensorDropM, maxPsi };
    const phys = tankCalibrationToPhysical(de, df);
    return { height: phys.tank_height_m, drop: phys.elevation_m, maxPsi };
  });

  protected height = computed(() => this.edits().height ?? this.baseline().height);
  protected drop = computed(() => this.edits().drop ?? this.baseline().drop);
  protected maxPsi = computed(() => this.baseline().maxPsi);
  protected dirty = computed(() => Object.keys(this.edits()).length > 0);

  /** psi anchors implied by the current physical inputs. */
  protected derived = computed(() => deriveTankCalibration(this.height(), this.drop()));

  /** Live level as a 0..1 fraction for the schematic's water fill (half when unknown). */
  protected waterFrac = computed(() => {
    const l = this.level();
    return l === null ? 0.5 : Math.max(0, Math.min(1, l / 100));
  });

  /** A psi value as a 0..100% position within the sensor's 0…max range (clamped). */
  protected pct(psi: number): number {
    const max = this.maxPsi();
    if (!(max > 0)) return 0;
    return Math.max(0, Math.min(100, (psi / max) * 100));
  }

  private deviceVal(key: string): number | null {
    const r = this.store.row(this.controller(), key);
    return r && Number.isFinite(r.reported) ? r.reported : null;
  }
  protected deviceEmpty = computed(() => this.deviceVal(this.cal().calEmptyKey));
  protected deviceFull = computed(() => this.deviceVal(this.cal().calFullKey));
  /** Live level as a 0..100 reading (unrounded), for display and pressure reconstruction. */
  private levelRaw = computed(() => {
    const r = this.store.row(this.controller(), this.cal().levelSensor);
    return r && Number.isFinite(r.reported) ? r.reported : null;
  });
  protected level = computed(() => {
    const l = this.levelRaw();
    return l === null ? null : Math.round(l);
  });
  /** Live sensor pressure (psi): the raw channel when the device emits it, else
   *  reconstructed from the live level % and the active anchors, since
   *  level % = (p - empty) / (full - empty). Shown even without a raw channel. */
  protected pressurePsi = computed<number | null>(() => {
    const key = this.cal().pressureSensor;
    if (key) {
      const r = this.store.row(this.controller(), key);
      if (r && Number.isFinite(r.reported)) return r.reported;
    }
    const l = this.levelRaw();
    if (l === null) return null;
    const empty = this.deviceEmpty() ?? this.derived().p_empty_psi;
    const full = this.deviceFull() ?? this.derived().p_full_psi;
    return empty + (l / 100) * (full - empty);
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
    for (const key of [cal.calEmptyKey, cal.calFullKey]) {
      const p = this.lifecycle.phaseFor(`${c}/cfg/${key}`);
      if (p) return p;
    }
    return null;
  });

  protected edit(field: 'height' | 'drop', ev: Event): void {
    const v = (ev.target as HTMLInputElement).value;
    this.edits.update((e) => {
      const n = { ...e };
      if (v === '') delete n[field]; else n[field] = Number(v);
      return n;
    });
  }

  /** Drop pending edits and fall back to the device baseline (what's live now). */
  protected discard(): void { this.edits.set({}); }

  /** Seed the form from the topology design geometry, for first-time calibration on
   *  a device that has no (or only a default) calibration yet. */
  protected loadDesign(): void {
    const cal = this.cal();
    this.edits.set({ height: cal.tankHeightM, drop: cal.sensorDropM });
  }

  /** Write the derived anchors as desired config (one upsert into controller_config),
   *  behind a hard confirm. The server recomputes + republishes the retained /config
   *  and the device applies both anchors; convergence shows once the shadow re-reports. */
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
      await this.lifecycle.writeDesiredConfig(c, {
        [cal.calEmptyKey]: round2(d.p_empty_psi),
        [cal.calFullKey]: round2(d.p_full_psi),
      });
      this.edits.set({}); // device now drives the display; convergence shows on the next snapshot
    } finally {
      this.saving.set(false);
    }
  }
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
