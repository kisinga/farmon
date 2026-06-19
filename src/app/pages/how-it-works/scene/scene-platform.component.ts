import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * MajiFlow platform zone: dashboard host, history/stats, alerts, MQTT bridge.
 * Static structure (the alert dot pulses via the global stylesheet); only the
 * dim state varies, so it takes a single `dim` input.
 */
@Component({
  selector: '[mfScenePlatform]',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'zone', '[class.dim]': 'dim()' },
  template: `
    <svg:rect x="556" y="296" width="250" height="190" rx="18" fill="#0d1830" stroke="rgba(120,170,220,.26)" stroke-width="2" />
    <svg:circle cx="577" cy="318" r="5" fill="var(--cyan)" />
    <svg:text x="590" y="322" class="nlabel" font-size="13">MajiFlow platform</svg:text>
    <!-- function rows -->
    <svg:rect x="570" y="334" width="222" height="27" rx="7" fill="#13243e" />
    <svg:text x="585" y="351" class="nsub" font-size="11">Dashboard host</svg:text>
    <svg:g>
      <svg:rect x="764" y="342" width="6" height="6" rx="1" fill="var(--sky)" />
      <svg:rect x="772" y="342" width="6" height="6" rx="1" fill="var(--sky)" />
      <svg:rect x="764" y="350" width="6" height="6" rx="1" fill="var(--sky)" />
      <svg:rect x="772" y="350" width="6" height="6" rx="1" fill="var(--sky)" />
    </svg:g>
    <svg:rect x="570" y="365" width="222" height="27" rx="7" fill="#13243e" />
    <svg:text x="585" y="382" class="nsub" font-size="11">History &amp; stats</svg:text>
    <svg:polyline points="752,385 760,379 768,383 776,374 784,380" fill="none" stroke="var(--cyan)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    <svg:rect x="570" y="396" width="222" height="27" rx="7" fill="#13243e" />
    <svg:text x="585" y="413" class="nsub" font-size="11">Alerts</svg:text>
    <svg:circle id="platAlert" cx="781" cy="409" r="4.5" fill="var(--amber)" />
    <svg:rect x="570" y="427" width="222" height="27" rx="7" fill="#13243e" />
    <svg:text x="585" y="444" class="nsub" font-size="11">MQTT bridge</svg:text>
    <svg:text x="784" y="444" class="tag" font-size="9.5" text-anchor="end">cmd ↓ · tlm ↑</svg:text>
    <svg:text x="681" y="522" class="nlabel" text-anchor="middle">The platform</svg:text>
    <svg:text x="681" y="543" class="nsub" text-anchor="middle">your dashboard, data &amp; alerts · managed cloud or on-site hub</svg:text>
  `,
})
export class ScenePlatformComponent {
  readonly dim = input(false);
}
