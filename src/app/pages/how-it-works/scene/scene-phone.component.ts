import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Web-interface zone: the phone/web dashboard mock. Live readouts (tank, flow,
 * litres) and the Start label come in as inputs; the tap ripple and the
 * closed-loop toast are driven by the host state classes (`.s-tap`, `.showtoast`)
 * via the global stylesheet, so this stays a pure presentational `<g>`.
 */
@Component({
  selector: '[mfScenePhone]',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'zone', '[class.dim]': 'dim()' },
  template: `
    <svg:rect x="150" y="300" width="194" height="392" rx="28" fill="#0c1424" stroke="rgba(120,170,220,.25)" stroke-width="2" />
    <svg:rect x="166" y="322" width="162" height="348" rx="16" fill="#070d18" />
    <svg:rect x="216" y="332" width="62" height="7" rx="3.5" fill="#1a2740" />
    <!-- app header -->
    <svg:text x="180" y="368" class="tag" font-size="10">MAJIFLOW</svg:text>
    <svg:circle cx="316" cy="362" r="5" fill="var(--green)" />
    <!-- route card -->
    <svg:rect x="178" y="384" width="138" height="92" rx="11" fill="#0f1c30" stroke="rgba(120,170,220,.18)" />
    <svg:text x="192" y="408" class="nlabel" font-size="13">Field A</svg:text>
    <svg:text x="192" y="427" class="nsub" font-size="10.5">Tank → Field A</svg:text>
    <svg:text x="192" y="452" class="nsub" font-size="10">Tank</svg:text>
    <svg:text x="300" y="452" class="tag" font-size="11" text-anchor="end">{{ tank() }}</svg:text>
    <svg:text x="192" y="468" class="nsub" font-size="10">Flow</svg:text>
    <svg:text x="300" y="468" class="tag" font-size="11" text-anchor="end">{{ flow() }}</svg:text>
    <!-- start button -->
    <svg:g id="startBtn">
      <svg:rect x="178" y="488" width="138" height="40" rx="11" fill="#16713a" stroke="rgba(70,255,122,.4)" />
      <svg:text x="247" y="513" class="nlabel" font-size="13.5" text-anchor="middle" fill="#dffbe7">{{ startLabel() }}</svg:text>
    </svg:g>
    <!-- litres readout -->
    <svg:rect x="178" y="540" width="138" height="58" rx="11" fill="#0f1c30" stroke="rgba(120,170,220,.14)" />
    <svg:text x="192" y="562" class="nsub" font-size="10">Delivered</svg:text>
    <svg:text x="308" y="588" class="tag" font-size="22" text-anchor="end">{{ litres() }}</svg:text>
    <svg:text x="308" y="566" class="nsub" font-size="9.5" text-anchor="end">litres</svg:text>
    <!-- tap ripple -->
    <svg:circle id="tapRing" cx="247" cy="508" r="4" fill="none" stroke="var(--cyan-br)" stroke-width="2.5" opacity="0" />
    <!-- live alert / confirmation toast (closed-loop) -->
    <svg:g id="phoneToast" opacity="0">
      <svg:rect x="178" y="608" width="138" height="30" rx="8" fill="rgba(70,255,122,.12)" stroke="rgba(70,255,122,.42)" />
      <svg:circle cx="193" cy="623" r="4" fill="var(--green)" />
      <svg:text x="205" y="627" class="nsub" font-size="9.5" fill="#cfeed6">Flow confirmed · Field A</svg:text>
    </svg:g>
    <!-- node label -->
    <svg:text x="247" y="726" class="nlabel" text-anchor="middle">Web dashboard</svg:text>
    <svg:text x="247" y="747" class="nsub" text-anchor="middle">phone or laptop · anywhere</svg:text>
  `,
})
export class ScenePhoneComponent {
  readonly dim = input(false);
  readonly tank = input('86%');
  readonly flow = input('0.0 L/min');
  readonly litres = input('0');
  readonly running = input(false);
  protected readonly startLabel = computed(() => (this.running() ? '■  Running…' : '▶  Start route'));
}
