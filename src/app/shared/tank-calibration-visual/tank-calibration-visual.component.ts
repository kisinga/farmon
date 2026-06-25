import { Component, computed, input, output } from '@angular/core';
import { deriveTankCalibration } from '@core';

/**
 * A field edit emitted upward, keyed by the tank node's field name. NOTE: these
 * keys are the editor's node schema; the dashboard (which writes desired config to
 * `controller_config` under different ids) will need an adapter to reuse this
 * component for editing.
 */
export interface CalibrationFieldEdit {
  field: 'height_m' | 'pressure_elevation_m';
  value: number | null;
}

/**
 * TankCalibrationVisualComponent — the calibration model as a picture.
 *
 * Presentational and service-free, so both the editor (design-time seeds) and the
 * dashboard (live device data) can mount it. It shows the tank geometry as a
 * schematic and where the tank's empty→full swing sits inside the sensor's psi
 * range — the "range used" that drives usable resolution. Sensor voltage is a
 * separate scaling spec and lives elsewhere; it has no effect on resolution.
 */
@Component({
  selector: 'app-tank-calibration-visual',
  standalone: true,
  template: `
    <div class="flex flex-col gap-2.5 text-xs">
      <!-- Schematic + the geometry inputs -->
      <div class="flex gap-3">
        <svg viewBox="0 0 72 104" class="shrink-0 w-16 h-24 text-base-content/35" fill="none" stroke="currentColor">
          <g stroke-width="1" stroke-linecap="round" class="text-base-content/25">
            <line x1="20" y1="8" x2="20" y2="66" /><line x1="17" y1="8" x2="23" y2="8" /><line x1="17" y1="66" x2="23" y2="66" />
            <line x1="20" y1="66" x2="20" y2="90" /><line x1="17" y1="90" x2="23" y2="90" />
          </g>
          <text x="9" y="40" font-size="9" fill="currentColor" stroke="none" class="text-base-content/45">h</text>
          <text x="9" y="81" font-size="9" fill="currentColor" stroke="none" class="text-base-content/45">d</text>
          <clipPath [attr.id]="'tcv-' + uid()"><rect x="31" y="9" width="28" height="56" rx="2.5" /></clipPath>
          <rect [attr.x]="31" [attr.y]="63 - 54 * waterFrac()" width="28" [attr.height]="54 * waterFrac()"
            stroke="none" class="fill-primary/35" [attr.clip-path]="'url(#tcv-' + uid() + ')'" />
          <rect x="31" y="9" width="28" height="56" rx="2.5" stroke-width="1.6" />
          <line x1="45" y1="65" x2="45" y2="89" stroke-width="2" />
          <rect x="39" y="89" width="12" height="8" rx="1.5" stroke-width="1.4" class="fill-base-200" />
        </svg>

        <div class="flex-1 grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1.5 content-center">
          <span class="text-base-content/60" title="Tank height — the water column">⬍ height</span>
          <input type="number" min="0" step="0.05" class="input input-xs input-bordered w-full text-right tabular-nums no-spin"
            [value]="heightM() ?? ''" [disabled]="!canEdit()" (input)="emit('height_m', $event)" />
          <span class="text-base-content/40">m</span>

          <span class="text-base-content/60" title="Vertical drop from tank outlet to the sensor">⬇ drop</span>
          <input type="number" min="0" step="0.05" class="input input-xs input-bordered w-full text-right tabular-nums no-spin"
            [value]="dropM() ?? ''" [disabled]="!canEdit()" (input)="emit('pressure_elevation_m', $event)" />
          <span class="text-base-content/40">m</span>
        </div>
      </div>

      @if (cal(); as c) {
        <!-- Where the tank's empty→full swing sits inside the sensor's 0…max psi. -->
        <div class="flex flex-col gap-1">
          <div class="relative h-2 rounded-full bg-base-200">
            <div class="absolute inset-y-0 rounded-full" [class]="rangeOk() ? 'bg-base-content/30' : 'bg-warning/50'"
              [style.left.%]="pct(c.p_empty_psi)" [style.right.%]="100 - pct(c.p_full_psi)"></div>
            @if (livePressurePsi() !== null && livePressurePsi() !== undefined) {
              <div class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-primary ring-2 ring-base-100"
                [style.left.%]="pct(livePressurePsi()!)"></div>
            }
          </div>
          <div class="flex justify-between text-[10px] text-base-content/45 tabular-nums">
            <span>psi 0</span>
            <span>empty {{ c.p_empty_psi.toFixed(1) }} · full {{ c.p_full_psi.toFixed(1) }}</span>
            <span>{{ sensorMaxPsi() }}</span>
          </div>
        </div>

        <div class="flex items-center gap-1.5 text-[11px]" [class.text-warning]="!rangeOk()" [class.text-base-content]="rangeOk()">
          <span class="opacity-60">▸ sensor range used</span>
          <span class="font-semibold tabular-nums">≈ {{ rangeUsedPct().toFixed(0) }}%</span>
          @if (!rangeOk()) { <span class="opacity-80">— low, reading sits near sensor noise</span> }
        </div>
      } @else {
        <div class="text-[10px] text-base-content/50">Enter tank height and sensor max to model the calibration.</div>
      }
    </div>
  `,
  styles: [`
    .no-spin::-webkit-outer-spin-button, .no-spin::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    .no-spin { -moz-appearance: textfield; appearance: textfield; }
  `],
})
export class TankCalibrationVisualComponent {
  readonly heightM = input<number | null>(null);
  readonly dropM = input<number | null>(0);
  /** Sensor full-scale rating (read-only here; edited as a sensor-spec field). */
  readonly sensorMaxPsi = input<number | null>(null);
  readonly canEdit = input(true);
  /** Live overlays (dashboard reuse) — null/undefined in the design-time editor. */
  readonly liveLevelPct = input<number | null>(null);
  readonly livePressurePsi = input<number | null>(null);

  readonly editField = output<CalibrationFieldEdit>();

  /** Stable id for the SVG clipPath, so multiple cards on a page don't collide. */
  readonly uid = input<string>(Math.random().toString(36).slice(2, 8));

  /** Range-use below which the reading sits near the sensor's noise floor (matches
   *  the `pressure-resolution` rule's 15%). */
  private readonly POOR_PCT = 15;

  protected cal = computed(() => {
    const h = this.heightM();
    const max = this.sensorMaxPsi();
    if (h === null || !(h > 0) || max === null || !(max > 0)) return null;
    return deriveTankCalibration(h, this.dropM() ?? 0);
  });

  protected waterFrac = computed(() => {
    const l = this.liveLevelPct();
    return l === null ? 0.5 : Math.max(0, Math.min(1, l / 100));
  });

  protected pct(psi: number): number {
    const max = this.sensorMaxPsi() ?? 0;
    if (!(max > 0)) return 0;
    return Math.max(0, Math.min(100, (psi / max) * 100));
  }

  /** Fraction of the sensor's psi range the tank's empty→full swing uses (0..100). */
  protected rangeUsedPct = computed(() => {
    const c = this.cal();
    const max = this.sensorMaxPsi() ?? 0;
    return c && max > 0 ? (c.working_span_psi / max) * 100 : 0;
  });

  protected rangeOk = computed(() => {
    const c = this.cal();
    const max = this.sensorMaxPsi() ?? 0;
    return !!c && c.p_full_psi <= max + 0.001 && this.rangeUsedPct() >= this.POOR_PCT;
  });

  protected emit(field: CalibrationFieldEdit['field'], ev: Event): void {
    const input = ev.target;
    if (!(input instanceof HTMLInputElement)) return;
    this.editField.emit({ field, value: input.value === '' ? null : Number(input.value) });
  }
}
