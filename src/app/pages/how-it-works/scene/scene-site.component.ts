import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Physical-site zone: tank (live water level), pump, motorized valve, flow sensor
 * and the field. Spin/sway/spray and the valve travel are driven by the host
 * `.flowing` / `.actuated` classes (global stylesheet). The live tank level, valve
 * label and flow readout come in as inputs from the engine.
 */
@Component({
  selector: '[mfSceneSite]',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'zone', '[class.dim]': 'dim()' },
  template: `
    <!-- TANK -->
    <svg:g id="tank">
      <svg:ellipse cx="1490" cy="520" rx="78" ry="20" fill="#13243e" stroke="rgba(120,170,220,.3)" />
      <svg:path d="M1412 520 L1412 690 A78 20 0 0 0 1568 690 L1568 520" fill="#0d1830" stroke="rgba(120,170,220,.3)" stroke-width="2" />
      <!-- water level (clipped) -->
      <svg:clipPath id="tankClip">
        <svg:path d="M1413 521 L1413 689 A77 19 0 0 0 1567 689 L1567 521 Z" />
      </svg:clipPath>
      <svg:g clip-path="url(#tankClip)">
        <svg:rect id="tankWater" x="1412" [attr.y]="tankTop()" width="156" [attr.height]="716 - tankTop()" fill="url(#gTank)" opacity="0.85" />
        <svg:ellipse id="tankSurf" cx="1490" [attr.cy]="tankTop()" rx="77" ry="14" fill="#7fe9fb" opacity="0.9" />
      </svg:g>
      <svg:text x="1490" y="700" class="nlabel" font-size="13" text-anchor="middle">Tank</svg:text>
    </svg:g>
    <!-- PUMP -->
    <svg:g id="pump">
      <svg:rect x="1700" y="700" width="104" height="64" rx="9" fill="#1a2740" stroke="rgba(120,170,220,.28)" stroke-width="2" />
      <svg:circle id="pumpRotor" cx="1752" cy="732" r="22" fill="#0f1c30" stroke="rgba(120,170,220,.4)" stroke-width="2" />
      <svg:g id="pumpBlades" style="transform-origin: 1752px 732px">
        <svg:path d="M1752 732 L1752 712 M1752 732 L1769 742 M1752 732 L1735 742" stroke="var(--sky)" stroke-width="3" stroke-linecap="round" />
      </svg:g>
      <svg:text x="1752" y="784" class="nsub" font-size="11" text-anchor="middle">Pump</svg:text>
    </svg:g>
    <!-- VALVE (2-wire motorized) -->
    <svg:g id="valve">
      <svg:rect id="valveActuator" x="2002" y="640" width="64" height="60" rx="8" fill="#1a2740" stroke="rgba(120,170,220,.3)" stroke-width="2" />
      <svg:text x="2034" y="660" class="nsub" font-size="8.5" text-anchor="middle">2-wire</svg:text>
      <!-- travel sweep arc (plays while the motor drives the valve open) -->
      <svg:path id="valveArc" d="M2018 684 A18 18 0 0 1 2050 684" fill="none" stroke="var(--cyan-br)" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="46" stroke-dashoffset="46" opacity="0" />
      <!-- stem -->
      <svg:rect x="2030" y="700" width="8" height="40" fill="#2a3850" />
      <!-- valve body on pipe -->
      <svg:circle cx="2034" cy="752" r="20" fill="#26344c" stroke="rgba(120,170,220,.35)" stroke-width="2" />
      <!-- flap that rotates open (closed = vertical/blocking, open = horizontal/aligned) -->
      <svg:g id="valveFlap" style="transform-box: fill-box; transform-origin: center">
        <svg:rect x="2026" y="734" width="16" height="36" rx="4" fill="var(--amber)" />
      </svg:g>
      <!-- state pill -->
      <svg:rect id="valvePill" x="2002" y="606" width="64" height="22" rx="11" fill="rgba(245,165,36,.16)" stroke="rgba(245,165,36,.5)" />
      <svg:text id="valveState" x="2034" y="621" font-size="11" font-weight="700" text-anchor="middle" fill="var(--amber)">{{ valveText() }}</svg:text>
      <svg:text x="2034" y="790" class="nsub" font-size="11" text-anchor="middle">Motorized valve</svg:text>
    </svg:g>
    <!-- FLOW SENSOR -->
    <svg:g id="flow">
      <svg:circle cx="2236" cy="752" r="26" fill="#0f1c30" stroke="rgba(120,170,220,.35)" stroke-width="2" />
      <svg:g id="impeller" style="transform-origin: 2236px 752px">
        <svg:path d="M2236 752 L2236 732 M2236 752 L2256 752 M2236 752 L2236 772 M2236 752 L2216 752" stroke="var(--cyan)" stroke-width="2.5" stroke-linecap="round" />
        <svg:circle cx="2236" cy="752" r="4" fill="var(--cyan-br)" />
      </svg:g>
      <svg:text x="2236" y="800" class="nsub" font-size="11" text-anchor="middle">Flow sensor</svg:text>
      <!-- pulse readout -->
      <svg:text id="flowRate" x="2236" y="716" class="tag" font-size="11" text-anchor="middle" opacity="0">{{ flowRateText() }}</svg:text>
    </svg:g>
    <!-- FIELD / crops -->
    <svg:g id="field">
      <!-- riser + sprinkler -->
      <svg:rect x="2356" y="660" width="8" height="92" fill="#2a3850" />
      <svg:circle cx="2360" cy="658" r="6" fill="#3a4a64" />
      <!-- crops -->
      <svg:g id="crops">
        <svg:g class="crop" style="transform-origin: 2430px 770px">
          <svg:path d="M2430 772 q-14 -22 -3 -42 q9 16 3 42" fill="#2f6b3a" />
          <svg:path d="M2430 772 q14 -20 4 -40 q-8 16 -4 40" fill="#357a44" />
        </svg:g>
        <svg:g class="crop" style="transform-origin: 2480px 770px">
          <svg:path d="M2480 772 q-14 -24 -3 -46 q9 18 3 46" fill="#2f6b3a" />
          <svg:path d="M2480 772 q14 -22 4 -44 q-8 18 -4 44" fill="#357a44" />
        </svg:g>
        <svg:g class="crop" style="transform-origin: 2530px 770px">
          <svg:path d="M2530 772 q-12 -20 -3 -38 q8 14 3 38" fill="#2f6b3a" />
          <svg:path d="M2530 772 q13 -18 4 -36 q-7 14 -4 36" fill="#357a44" />
        </svg:g>
      </svg:g>
      <svg:text x="2480" y="812" class="nsub" font-size="11" text-anchor="middle">Field A</svg:text>
    </svg:g>
    <!-- spray droplets (animated via the host .flowing class) -->
    <svg:g id="spray">
      @for (d of droplets; track $index) {
        <svg:circle class="spray-drop" cx="2360" cy="658" [attr.r]="d.r" fill="#bdf3ff"
          [style.--dx]="d.dx + 'px'" [style.animation-duration]="d.dur + 's'" [style.animation-delay]="d.delay + 's'" />
      }
    </svg:g>
  `,
})
export class SceneSiteComponent {
  readonly dim = input(false);
  /** Top y of the tank-water rect (and the surface ellipse cy); 556 = full. */
  readonly tankTop = input(556);
  readonly valveText = input('CLOSED');
  readonly flowRateText = input('0 L/min');

  /** Deterministic sprinkler droplets (SSR-stable; no Math.random at render). */
  protected readonly droplets = Array.from({ length: 7 }, (_, i) => ({
    r: 3 + (i % 3),
    dx: -40 + i * 16,
    dur: (0.9 + (i % 3) * 0.18).toFixed(2),
    delay: (i * 0.13).toFixed(2),
  }));
}
