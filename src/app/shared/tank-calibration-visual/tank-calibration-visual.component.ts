import { Component, computed, input, output } from '@angular/core';
import { deriveTankCalibration } from '@core';

/**
 * A field edit emitted upward, keyed by the tank node's field name. NOTE: these
 * keys are the editor's node schema; the dashboard (which writes via `config_set`
 * under different ids) will need an adapter to reuse this component for editing.
 */
export interface CalibrationFieldEdit {
  field: 'height_m' | 'pressure_elevation_m' | 'pressure_sensor_max_psi' | 'pressure_sensor_output_v';
  value: number | null;
}

/**
 * TankCalibrationVisualComponent — the calibration model as a picture.
 *
 * Presentational and service-free, so both the editor (design-time seeds) and the
 * dashboard (live device data) can mount it. It shows three things at a glance:
 *   - a schematic of the tank, its sensor drop, and the live water level
 *   - the empty→full band inside the sensor's 0…max psi range
 *   - the sensor's output voltage inside the board's ADC input range
 * The two bars together ARE the resolution warning: the lit overlap is the usable
 * resolution; a thin lit region turns amber instead of spelling out a sentence.
 */
@Component({
  selector: 'app-tank-calibration-visual',
  standalone: true,
  template: `
    <div class="flex flex-col gap-2.5 text-xs">
      <!-- Schematic + the four model inputs -->
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
          <span class="text-base-content/60" title="Tank height — the water column">⬍ h</span>
          <input type="number" min="0" step="0.05" class="input input-xs input-bordered w-full text-right tabular-nums no-spin"
            [value]="heightM() ?? ''" [disabled]="!canEdit()" (input)="emit('height_m', $event)" />
          <span class="text-base-content/40">m</span>

          <span class="text-base-content/60" title="Vertical drop from tank outlet to the sensor">⬇ d</span>
          <input type="number" min="0" step="0.05" class="input input-xs input-bordered w-full text-right tabular-nums no-spin"
            [value]="dropM() ?? ''" [disabled]="!canEdit()" (input)="emit('pressure_elevation_m', $event)" />
          <span class="text-base-content/40">m</span>

          <span class="text-base-content/60" title="Sensor full-scale rating">⌁ max</span>
          <input type="number" min="0" step="0.5" class="input input-xs input-bordered w-full text-right tabular-nums no-spin"
            [value]="sensorMaxPsi() ?? ''" [disabled]="!canEdit()" (input)="emit('pressure_sensor_max_psi', $event)" />
          <span class="text-base-content/40">psi</span>

          <span class="text-base-content/60" title="Sensor output voltage at full scale (datasheet)">⚡ out</span>
          <input type="number" min="0" step="0.1" class="input input-xs input-bordered w-full text-right tabular-nums no-spin"
            [value]="sensorOutputV() ?? ''" [disabled]="!canEdit()" [attr.placeholder]="boardAdcRangeV()"
            (input)="emit('pressure_sensor_output_v', $event)" />
          <span class="text-base-content/40">V</span>
        </div>
      </div>

      @if (cal(); as c) {
        <!-- psi range: empty→full band inside 0…max, live pressure dot if known -->
        <div class="flex flex-col gap-1">
          <div class="relative h-2 rounded-full bg-base-200">
            <div class="absolute inset-y-0 rounded-full" [class]="psiOk() ? 'bg-base-content/30' : 'bg-warning/50'"
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

        <!-- ADC range: sensor output lit inside the board input range, rest dimmed -->
        <div class="flex flex-col gap-1">
          <div class="relative h-2 rounded-full bg-base-200 overflow-hidden">
            <div class="absolute inset-y-0 left-0 rounded-full" [class]="voltOk() ? 'bg-base-content/30' : 'bg-warning/50'"
              [style.width.%]="voltUtilPct()"></div>
          </div>
          <div class="flex justify-between text-[10px] text-base-content/45 tabular-nums">
            <span>adc 0</span>
            <span [class.text-warning]="!voltOk()">sensor reaches {{ voltUtilPct().toFixed(0) }}%</span>
            <span>{{ boardAdcRangeV() }}V</span>
          </div>
        </div>

        <!-- The product: usable resolution. Amber when low — no sentence needed. -->
        <div class="flex items-center gap-1.5 text-[11px]" [class.text-warning]="!resolutionOk()" [class.text-base-content]="resolutionOk()">
          <span class="opacity-60">▸ usable resolution</span>
          <span class="font-semibold tabular-nums">≈ {{ effectivePct().toFixed(0) }}%</span>
          @if (!resolutionOk()) { <span class="opacity-80">— low</span> }
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
  readonly sensorMaxPsi = input<number | null>(null);
  readonly sensorOutputV = input<number | null>(null);
  readonly boardAdcRangeV = input<number>(3.3);
  readonly canEdit = input(true);
  /** Live overlays (dashboard reuse) — null/undefined in the design-time editor. */
  readonly liveLevelPct = input<number | null>(null);
  readonly livePressurePsi = input<number | null>(null);

  readonly editField = output<CalibrationFieldEdit>();

  /** Stable id for the SVG clipPath, so multiple cards on a page don't collide. */
  readonly uid = input<string>(Math.random().toString(36).slice(2, 8));

  /** Effective-resolution threshold below which the model reads as poor (matches the
   *  `pressure-resolution` rule's 15%). */
  private readonly POOR_PCT = 15;
  /** Voltage-utilisation below this dims the ADC bar to amber — a softer, single-factor
   *  cue than POOR_PCT (which gates the combined resolution). Half the range = the point
   *  past which a mismatched sensor is worth flagging on its own. */
  private readonly LOW_VOLT_PCT = 50;

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

  /** Fraction of the board ADC range the sensor's full output reaches (0..100). */
  protected voltUtilPct = computed(() => {
    const range = this.boardAdcRangeV();
    if (!(range > 0)) return 100;
    const out = this.sensorOutputV() ?? range;
    return Math.max(0, Math.min(100, (out / range) * 100));
  });

  /** Fraction of the sensor's psi range the tank's empty→full swing uses (0..100). */
  protected psiUtilPct = computed(() => {
    const c = this.cal();
    const max = this.sensorMaxPsi() ?? 0;
    return c && max > 0 ? (c.working_span_psi / max) * 100 : 0;
  });

  /** Resolution actually usable = psi factor × voltage factor. */
  protected effectivePct = computed(() => (this.psiUtilPct() * this.voltUtilPct()) / 100);

  protected psiOk = computed(() => {
    const c = this.cal();
    const max = this.sensorMaxPsi() ?? 0;
    // Healthy psi factor unless undersized (full exceeds range) or swing is tiny.
    return !!c && c.p_full_psi <= max + 0.001 && this.psiUtilPct() >= this.POOR_PCT;
  });
  protected voltOk = computed(() => this.voltUtilPct() >= this.LOW_VOLT_PCT);
  protected resolutionOk = computed(() => this.effectivePct() >= this.POOR_PCT);

  protected emit(field: CalibrationFieldEdit['field'], ev: Event): void {
    const input = ev.target;
    if (!(input instanceof HTMLInputElement)) return;
    this.editField.emit({ field, value: input.value === '' ? null : Number(input.value) });
  }
}
