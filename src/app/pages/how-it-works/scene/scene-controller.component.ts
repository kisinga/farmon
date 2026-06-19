import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Controller zone: the KC868-A16 board, ESP32, relay/MOSFET output row and the
 * pre-flight check badge. The status/output LEDs glow via the host `.actuated`
 * class (global stylesheet); the check badge fades in when `showCheck` is set.
 */
@Component({
  selector: '[mfSceneController]',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'zone', '[class.dim]': 'dim()' },
  template: `
    <!-- DIN rail -->
    <svg:rect x="980" y="624" width="380" height="16" rx="3" fill="#2a3346" />
    <!-- board -->
    <svg:rect x="1006" y="430" width="372" height="196" rx="10" fill="url(#gPCB)" stroke="#0a3d20" stroke-width="2" />
    <!-- ESP32 module -->
    <svg:rect x="1300" y="452" width="62" height="86" rx="5" fill="#10151d" />
    <svg:rect x="1308" y="460" width="46" height="46" rx="3" fill="#c7ccd4" />
    <svg:text x="1331" y="556" class="nsub" font-size="9" text-anchor="middle" fill="#9fb6cc">ESP32</svg:text>
    <!-- status LED -->
    <svg:circle id="ctrlLed" cx="1030" cy="452" r="7" fill="#2a3a2c" />
    <svg:text x="1046" y="456" class="nsub" font-size="9.5">PWR</svg:text>
    <!-- relay / MOSFET output row (the active one, the valve, is index 0) -->
    <svg:g id="relayRow">
      @for (i of bodies; track i) {
        <svg:rect [attr.x]="1024 + i * 36" y="556" width="30" height="46" rx="3" fill="#14181f" />
      }
      <!-- output indicator LEDs -->
      <svg:rect id="outLed" x="1031" y="544" width="16" height="6" rx="2" fill="#3a201d" />
      <svg:rect x="1067" y="544" width="16" height="6" rx="2" fill="#3a201d" />
      <svg:rect x="1103" y="544" width="16" height="6" rx="2" fill="#3a201d" />
    </svg:g>
    <!-- terminal block (outputs, bottom) -->
    <svg:rect x="1024" y="606" width="180" height="14" rx="2" fill="#1fae54" />
    <svg:text x="1192" y="478" class="tag" font-size="11">16× outputs</svg:text>
    <svg:text x="1192" y="498" class="nsub" font-size="10.5">opto-isolated I/O</svg:text>
    <svg:text x="1192" y="516" class="nsub" font-size="10.5">Ethernet · WiFi · RS485</svg:text>
    <!-- node label -->
    <svg:text x="1192" y="672" class="nlabel" text-anchor="middle">The controller</svg:text>
    <svg:text x="1192" y="693" class="nsub" text-anchor="middle">runs its own schedule + safety checks</svg:text>
    <!-- pre-flight check badge -->
    <svg:g id="checkBadge" [class.show]="showCheck()">
      <svg:rect x="1066" y="372" width="252" height="44" rx="10" fill="rgba(70,255,122,.1)" stroke="rgba(70,255,122,.45)" />
      <svg:circle cx="1090" cy="394" r="9" fill="none" stroke="var(--green)" stroke-width="2.5" />
      <svg:path d="M1085 394 l4 4 l7 -9" fill="none" stroke="var(--green)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      <svg:text x="1110" y="389" font-size="11.5" font-weight="700" fill="#cfeed6">Pre-flight checks pass</svg:text>
      <svg:text x="1110" y="405" class="nsub" font-size="10">source has water · destination has room</svg:text>
    </svg:g>
  `,
})
export class SceneControllerComponent {
  readonly dim = input(false);
  readonly showCheck = input(false);
  protected readonly bodies = [0, 1, 2, 3, 4];
}
