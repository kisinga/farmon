import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { avifSrc, webpSrc } from '../marketing-image';

/** One physical device on the cinematic hardware stage. */
export interface HardwareDevice {
  index: string;
  name: string;
  kicker: string;
  body: string;
  /** Hero image path under public/ (.jpg; <picture> derives .avif/.webp). */
  main: string;
  /** Other angle shots, shown as thumbnails that swap the hero on hover. */
  angles: string[];
  /** Short HUD spec chips that float around the device. */
  specs: string[];
}

/** Canonical device list — single source of copy/specs/images for every page. */
export const HARDWARE_DEVICES: HardwareDevice[] = [
  {
    index: '01',
    name: 'The controller',
    kicker: 'THE BRAIN ON THE WALL',
    body: 'Reads your sensors, switches your pumps and valves, and reports back to your dashboard. Rail-mounted, wired once, then left alone for years.',
    main: 'marketing/Controller4.jpg',
    angles: ['marketing/Controller1.jpg', 'marketing/Controller5.jpg'],
    specs: ['16 relays', 'USB-C', '12V DC', 'Rail mount'],
  },
  {
    index: '02',
    name: 'Motorised valve',
    kicker: 'OPENS AND CLOSES ON COMMAND',
    body: 'Opens and closes a water line on its own, on a schedule or on command. Brass body, three-wire control, no one standing at the tap.',
    main: 'marketing/valve3.jpg',
    angles: ['marketing/valve5.jpg', 'marketing/valve1.jpg', 'marketing/valve6.jpg'],
    specs: ['Brass body', '3-wire', 'Motorised', 'DN20 / DN25'],
  },
  {
    index: '03',
    name: 'Pressure sensor',
    kicker: 'READS HOW FULL THE TANK IS',
    body: 'Sits at the bottom of a tank and reads the weight of water above it. The deeper the water, the higher the pressure, so once it is set from empty to full it reports exactly how full the tank is. No float to stick, nothing moving to wear out.',
    main: 'marketing/pressure-sensor1.jpg',
    angles: ['marketing/pressure-sensor4.jpg', 'marketing/pressure-sensor2.jpg', 'marketing/pressure-sensor3.jpg'],
    specs: ['Stainless steel', 'Threaded port', '3-wire', 'Reads tank level'],
  },
];

/**
 * Shared hardware showcase. Each device sits on a dark cinematic stage: it floats,
 * tilts to the cursor (desktop only), a scan-line sweeps it, HUD brackets + glowing
 * spec chips assemble, and angle thumbnails swap the hero shot.
 *
 * Two presets via `variant`:
 *  - `full` — the three-device marketing stage (features page): full-bleed dark
 *    section, animated grid backdrop, alternating rows, scroll-assemble.
 *  - `hero` — a distilled one-device panel (landing page): a contained dark card,
 *    no grid/assemble, fewer chips, one glow. Drop in 1+ devices either way.
 *
 * Tuned for budget devices: no `mix-blend-mode`, glows pulse opacity only (never
 * scale a large gradient), tilt is mouse-only + rAF-throttled, and all motion is
 * gated on prefers-reduced-motion. Prerender-safe — window is only touched inside
 * pointer handlers, which never run during SSR.
 */
@Component({
  selector: 'app-hardware-showcase',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  styles: [`
    :host { --cyan: #22d3ee; }

    @keyframes grid-pan { to { background-position: 80px 80px; } }
    /* opacity-only: scaling a large radial gradient repaints a huge area each frame */
    @keyframes glow-pulse { 0%,100% { opacity:.45; } 50% { opacity:.8; } }
    @keyframes float-bob { 0%,100% { transform: translateY(0) rotate(-.4deg);} 50% { transform: translateY(-14px) rotate(.4deg);} }
    @keyframes scan { 0% { transform: translateY(-130%);} 100% { transform: translateY(130%);} }
    @keyframes chip-bob { 0%,100% { transform: translateY(0);} 50% { transform: translateY(-7px);} }
    @keyframes assemble { from { opacity:0; transform: translateY(36px); } to { opacity:1; transform:none; } }
    @keyframes bracket-in { from { opacity:0; } to { opacity:1; } }

    .hw-grid {
      background-image:
        linear-gradient(to right, rgba(34,211,238,.07) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(34,211,238,.07) 1px, transparent 1px);
      background-size: 40px 40px;
      animation: grid-pan 6s linear infinite;
      mask-image: radial-gradient(ellipse 70% 70% at 50% 50%, #000 30%, transparent 75%);
    }
    .hw-glow { animation: glow-pulse 5s ease-in-out infinite; }

    .hw-stage { perspective: 1100px; }
    .hw-tilt { transition: transform .25s ease-out; transform-style: preserve-3d;
               transform: rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg)); }
    .hw-float { animation: float-bob 7s ease-in-out infinite; }
    .hw-device { filter: drop-shadow(0 30px 40px rgba(0,0,0,.55)); }

    /* additive look without mix-blend-mode (which forces an isolated layer per frame) */
    .hw-scan { animation: scan 4.5s ease-in-out infinite; }

    .hw-bracket { animation: bracket-in .6s ease both; }

    .hw-chip { animation: chip-bob 5s ease-in-out infinite; }
    .hw-chip:nth-of-type(2) { animation-delay: -1.2s; }
    .hw-chip:nth-of-type(3) { animation-delay: -2.4s; }
    .hw-chip:nth-of-type(4) { animation-delay: -3.6s; }

    /* scroll-driven assemble of each row, where supported */
    @supports (animation-timeline: view()) {
      .hw-anim { animation: assemble linear both; animation-timeline: view(); animation-range: entry 5% entry 42%; }
    }

    @media (prefers-reduced-motion: reduce) {
      .hw-grid, .hw-glow, .hw-float, .hw-scan, .hw-chip, .hw-bracket { animation: none; }
      .hw-anim { animation: none; opacity: 1; transform: none; }
      .hw-scan { display: none; }
      .hw-tilt { transition: none; transform: none; }
    }
  `],
  template: `
    <section class="relative overflow-hidden bg-slate-950 text-white"
             [class]="full() ? 'px-5 sm:px-8 py-24 sm:py-32' : 'rounded-3xl ring-1 ring-white/10 px-5 sm:px-8 py-12 sm:py-16'">
      <!-- animated backdrop (full stage only) -->
      @if (full()) {
        <div class="hw-grid pointer-events-none absolute inset-0"></div>
        <div class="hw-glow pointer-events-none absolute -top-32 left-1/4 w-[36rem] h-[36rem] rounded-full bg-radial from-cyan-500/25 to-transparent to-70%"></div>
        <div class="hw-glow pointer-events-none absolute -bottom-40 right-1/4 w-[34rem] h-[34rem] rounded-full bg-radial from-sky-500/20 to-transparent to-70%" style="animation-delay:-2.5s"></div>
      } @else {
        <div class="hw-glow pointer-events-none absolute -top-24 right-0 w-[30rem] h-[30rem] rounded-full bg-radial from-cyan-500/20 to-transparent to-70%"></div>
      }

      <div class="relative mx-auto" [class.max-w-6xl]="full()">
        @if (showHeader()) {
          <div class="text-center max-w-2xl mx-auto">
            <p class="font-mono text-xs tracking-[0.35em] text-cyan-300/80">{{ kicker() }}</p>
            <h2 class="mt-4 text-3xl sm:text-5xl font-bold tracking-tight leading-[1.05]">{{ heading() }}</h2>
            <p class="mt-5 text-white/60 text-sm sm:text-lg leading-relaxed">{{ subhead() }}</p>
          </div>
        }

        <!-- rows -->
        <div [class]="full() ? 'mt-24 sm:mt-32 space-y-28 sm:space-y-40' : ''">
          @for (it of devices(); track it.name; let i = $index) {
            @let heroImg = heroOf(i, it);
            <div class="grid items-center gap-12 lg:gap-20 lg:grid-cols-2" [class.hw-anim]="full()">

              <!-- STAGE -->
              <div class="hw-stage relative" [class.lg:order-2]="full() && i % 2 === 1"
                   (pointermove)="tilt($event)" (pointerleave)="resetTilt($event)">

                <!-- glow halo behind device -->
                <div class="hw-glow pointer-events-none absolute inset-8 rounded-[2.5rem] bg-radial from-cyan-400/25 to-transparent to-70%"></div>

                <div class="hw-tilt relative mx-auto max-w-md">
                  <!-- glass plate -->
                  <div class="relative rounded-[2rem] bg-white/[0.04] ring-1 ring-white/10 backdrop-blur-sm p-6 sm:p-8 overflow-hidden">
                    <!-- scan sweep -->
                    <div class="hw-scan pointer-events-none absolute inset-x-0 -top-1/3 h-1/3 bg-gradient-to-b from-transparent via-cyan-300/45 to-transparent"></div>

                    <!-- hero device -->
                    <div class="hw-float">
                      <picture>
                        <source [srcset]="avifSrc(heroImg)" type="image/avif" />
                        <source [srcset]="webpSrc(heroImg)" type="image/webp" />
                        <img [src]="heroImg" [alt]="it.name"
                             class="hw-device block w-full aspect-[4/3] object-contain" decoding="async" />
                      </picture>
                    </div>

                    <!-- HUD corner brackets -->
                    <span class="hw-bracket absolute left-3 top-3 w-7 h-7 border-l-2 border-t-2 border-cyan-300/70 rounded-tl-lg" style="animation-delay:.15s"></span>
                    <span class="hw-bracket absolute right-3 top-3 w-7 h-7 border-r-2 border-t-2 border-cyan-300/70 rounded-tr-lg" style="animation-delay:.3s"></span>
                    <span class="hw-bracket absolute left-3 bottom-3 w-7 h-7 border-l-2 border-b-2 border-cyan-300/70 rounded-bl-lg" style="animation-delay:.45s"></span>
                    <span class="hw-bracket absolute right-3 bottom-3 w-7 h-7 border-r-2 border-b-2 border-cyan-300/70 rounded-br-lg" style="animation-delay:.6s"></span>
                  </div>

                  <!-- floating spec chips -->
                  @for (s of chipsFor(it); track s; let k = $index) {
                    <span class="hw-chip absolute font-mono text-[11px] tracking-wider text-cyan-100 bg-slate-900/70 ring-1 ring-cyan-300/30 rounded-full px-3 py-1 backdrop-blur-sm shadow-lg shadow-cyan-500/10"
                          [class]="chipPos[k]">{{ s }}</span>
                  }
                </div>

                <!-- angle thumbnails (hero shot first, then alternate angles) -->
                <div class="mt-7 flex justify-center gap-3">
                  @for (a of [it.main, ...it.angles]; track a) {
                    <button type="button" (mouseenter)="setHero(i, a)" (focus)="setHero(i, a)"
                            class="w-16 h-12 rounded-lg overflow-hidden ring-1 transition-all"
                            [class]="heroImg === a ? 'ring-cyan-400' : 'ring-white/15 opacity-60 hover:opacity-100'">
                      <img [src]="a" alt="" loading="lazy" decoding="async" class="w-full h-full object-cover" />
                    </button>
                  }
                </div>
              </div>

              <!-- CONTENT -->
              <div [class.lg:order-1]="full() && i % 2 === 1">
                <div class="font-mono text-6xl sm:text-7xl font-bold text-white/10 leading-none">{{ it.index }}</div>
                <div class="mt-2 w-12 h-1 bg-cyan-400 rounded-full"></div>
                <h3 class="mt-5 text-2xl sm:text-4xl font-bold tracking-tight">{{ it.name }}</h3>
                <p class="mt-2 font-mono text-xs tracking-[0.25em] text-cyan-300/80">{{ it.kicker }}</p>
                <p class="mt-5 text-white/65 text-sm sm:text-base leading-relaxed max-w-md">{{ it.body }}</p>
              </div>
            </div>
          }
        </div>
      </div>
    </section>
  `,
})
export class HardwareShowcaseComponent {
  readonly devices = input.required<HardwareDevice[]>();
  readonly variant = input<'full' | 'hero'>('full');
  readonly showHeader = input(true);
  readonly heading = input('Built for water. Ready to install.');
  readonly kicker = input('THE HARDWARE');
  readonly subhead = input('Off-the-shelf parts a plumber can fit. No mystery boxes, nothing you cannot replace.');

  protected readonly avifSrc = avifSrc;
  protected readonly webpSrc = webpSrc;

  /** Which hero image is active per row index (defaults to each device's main). */
  private readonly hero = signal<Record<number, string>>({});

  /** rAF-coalesced tilt state, so pointermove writes the transform once per frame. */
  private rafId = 0;
  private tiltEl: HTMLElement | null = null;
  private tiltX = 0;
  private tiltY = 0;

  /** Absolute placement classes for up to four floating spec chips. */
  protected readonly chipPos = [
    '-top-3 right-6 sm:-right-4',
    'top-1/3 -left-3 sm:-left-6',
    'bottom-1/4 -right-3 sm:-right-7',
    '-bottom-3 left-8',
  ];

  protected readonly full = computed(() => this.variant() === 'full');

  /** Hero variant keeps the device uncluttered: just the two headline specs. */
  protected chipsFor(it: HardwareDevice): string[] {
    return this.full() ? it.specs : it.specs.slice(0, 2);
  }

  protected heroOf(i: number, it: HardwareDevice): string {
    return this.hero()[i] ?? it.main;
  }
  protected setHero(i: number, src: string): void {
    this.hero.update((m) => ({ ...m, [i]: src }));
  }

  /**
   * Tilt the stage toward the pointer — mouse only (touch/pen skip it) and
   * coalesced into one requestAnimationFrame write per frame.
   */
  protected tilt(e: PointerEvent): void {
    if (e.pointerType !== 'mouse') return;
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    this.tiltX = (e.clientX - r.left) / r.width - 0.5;
    this.tiltY = (e.clientY - r.top) / r.height - 0.5;
    this.tiltEl = el;
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      const t = this.tiltEl;
      if (!t) return;
      t.style.setProperty('--ry', `${this.tiltX * 12}deg`);
      t.style.setProperty('--rx', `${-this.tiltY * 12}deg`);
    });
  }
  protected resetTilt(e: PointerEvent): void {
    const el = e.currentTarget as HTMLElement;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  }
}
