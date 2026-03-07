import { Component, input } from '@angular/core';

@Component({
  selector: 'app-logo',
  standalone: true,
  template: `
    <img
      [src]="src()"
      [alt]="alt()"
      [class]="class()"
      [width]="width()"
      [height]="height()"
      loading="eager"
      fetchpriority="high"
    />
  `,
})
export class LogoComponent {
  /** Logo URL (default: FarMon plant + arcs SVG). */
  src = input('/logo.svg');
  alt = input('FarMon');
  /** Tailwind classes for size/layout (e.g. h-8 w-auto). */
  class = input('h-8 w-auto shrink-0');
  width = input(27);
  height = input(32);
}
