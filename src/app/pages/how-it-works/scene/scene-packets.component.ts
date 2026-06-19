import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Animated overlay drawn on top of the zones: the command/automation/telemetry
 * packets, the continuous telemetry stream, the arrival-burst rings and the
 * water leading edge. All motion is driven by the host state classes (`.s-cmd`,
 * `.s-control`, `.s-tele`, `.flowing`) and `offset-path` in the global stylesheet;
 * the telemetry stage also re-fires individual bursts by id from the engine.
 */
@Component({
  selector: '[mfScenePackets]',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- command packet: phone -> platform -> controller -->
    <svg:g id="cmdPacket" opacity="0">
      <svg:circle r="16" fill="url(#gGlow)" />
      <svg:circle r="6" fill="var(--cyan-br)" />
    </svg:g>
    <!-- parallel automation trigger packet: automation -> platform -->
    <svg:g id="cmdAuto" opacity="0">
      <svg:circle r="11" fill="url(#gGlow)" />
      <svg:circle r="4.5" fill="var(--sky)" />
    </svg:g>
    <!-- continuous telemetry / stats up-stream (runs in parallel with commands) -->
    <svg:g id="statStream">
      @for (d of streamDots; track d) {
        <svg:circle class="statDot" r="3.6" fill="var(--cyan-br)" />
      }
    </svg:g>
    <!-- control pulse: controller -> valve -->
    <svg:g id="ctrlPulse" opacity="0">
      <svg:circle r="14" fill="url(#gGlow)" />
      <svg:circle r="5.5" fill="var(--green)" />
    </svg:g>
    <!-- telemetry packet: sensor -> controller -> server -> phone -->
    <svg:g id="telePacket" opacity="0">
      <svg:circle r="14" fill="url(#gGlow)" />
      <svg:circle r="5.5" fill="var(--cyan-br)" />
    </svg:g>
    <!-- arrival burst rings (the packet "landing" on each node) -->
    @for (b of bursts; track b.id) {
      <svg:circle [id]="b.id" class="burst" [attr.cx]="b.cx" [attr.cy]="b.cy" r="6" fill="none" [attr.stroke]="b.stroke" stroke-width="4" />
    }
    <!-- water leading edge -->
    <svg:g id="waterHead" opacity="0">
      <svg:circle r="15" fill="url(#gGlow)" />
      <svg:circle r="5" fill="#d7f7ff" />
    </svg:g>
  `,
})
export class ScenePacketsComponent {
  /** The three continuous telemetry dots (staggered via CSS nth-child). */
  protected readonly streamDots = [0, 1, 2];
  protected readonly bursts = [
    { id: 'burstServer', cx: 676, cy: 392, stroke: 'var(--cyan-br)' },
    { id: 'burstCtrl', cx: 1190, cy: 544, stroke: 'var(--cyan-br)' },
    { id: 'burstValve', cx: 2034, cy: 700, stroke: 'var(--green)' },
    { id: 'burstFlow', cx: 2236, cy: 752, stroke: 'var(--cyan-br)' },
    { id: 'burstPhone', cx: 247, cy: 486, stroke: 'var(--cyan-br)' },
  ];
}
