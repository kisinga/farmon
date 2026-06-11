import { Component, signal } from '@angular/core';

interface HardwareItem {
  index: string;
  name: string;
  kicker: string;
  body: string;
  /** Hero image path under public/. */
  main: string;
  /** Other angle shots, shown as thumbnails that swap the hero on hover. */
  angles: string[];
  /** Short HUD spec chips that float around the device. */
  specs: string[];
}

/**
 * Animated hardware showcase for the features page. Each component sits on a
 * dark cinematic stage: the device floats and tilts to the cursor, a scan-line
 * sweeps it, HUD brackets + glowing spec chips assemble on scroll, and angle
 * thumbnails swap the hero shot. All motion is CSS (scroll-driven where it can
 * be) plus a tiny pointer-tilt handler, so it is prerender-safe and honours
 * prefers-reduced-motion.
 */
@Component({
  selector: 'app-hardware-showcase',
  standalone: true,
  host: { class: 'block' },
  styles: [`
    :host { --cyan: #22d3ee; }

    /* moving backdrop grid */
    @keyframes grid-pan { to { background-position: 80px 80px; } }
    @keyframes glow-pulse { 0%,100% { opacity:.5; transform:scale(1);} 50% { opacity:.85; transform:scale(1.08);} }
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

    .hw-scan { animation: scan 4.5s ease-in-out infinite; mix-blend-mode: plus-lighter; }

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
    }
  `],
  template: `
    <section class="relative overflow-hidden bg-slate-950 text-white px-5 sm:px-8 py-24 sm:py-32">
      <!-- animated backdrop -->
      <div class="hw-grid pointer-events-none absolute inset-0"></div>
      <div class="hw-glow pointer-events-none absolute -top-32 left-1/4 w-[36rem] h-[36rem] rounded-full bg-radial from-cyan-500/25 to-transparent to-70%"></div>
      <div class="hw-glow pointer-events-none absolute -bottom-40 right-1/4 w-[34rem] h-[34rem] rounded-full bg-radial from-sky-500/20 to-transparent to-70%" style="animation-delay:-2.5s"></div>

      <div class="relative max-w-6xl mx-auto">
        <!-- header -->
        <div class="text-center max-w-2xl mx-auto">
          <p class="font-mono text-xs tracking-[0.35em] text-cyan-300/80">THE HARDWARE</p>
          <h2 class="mt-4 text-3xl sm:text-5xl font-bold tracking-tight leading-[1.05]">Built for water. Ready to install.</h2>
          <p class="mt-5 text-white/60 text-sm sm:text-lg leading-relaxed">
            Off-the-shelf parts a plumber can fit. No mystery boxes, nothing you cannot replace.
          </p>
        </div>

        <!-- rows -->
        <div class="mt-24 sm:mt-32 space-y-28 sm:space-y-40">
          @for (it of items; track it.name; let i = $index) {
            <div class="hw-anim grid items-center gap-12 lg:gap-20 lg:grid-cols-2">

              <!-- STAGE -->
              <div class="hw-stage relative" [class.lg:order-2]="i % 2 === 1"
                   (pointermove)="tilt($event)" (pointerleave)="resetTilt($event)">

                <!-- glow halo behind device -->
                <div class="hw-glow pointer-events-none absolute inset-8 rounded-[2.5rem] bg-radial from-cyan-400/25 to-transparent to-70%"></div>

                <div class="hw-tilt relative mx-auto max-w-md">
                  <!-- glass plate -->
                  <div class="relative rounded-[2rem] bg-white/[0.04] ring-1 ring-white/10 backdrop-blur-sm p-6 sm:p-8 overflow-hidden">
                    <!-- scan sweep -->
                    <div class="hw-scan pointer-events-none absolute inset-x-0 -top-1/3 h-1/3 bg-gradient-to-b from-transparent via-cyan-300/35 to-transparent"></div>

                    <!-- hero device -->
                    <div class="hw-float">
                      <img [src]="heroOf(i)" [alt]="it.name"
                           class="hw-device block w-full aspect-[4/3] object-contain" decoding="async" />
                    </div>

                    <!-- HUD corner brackets -->
                    <span class="hw-bracket absolute left-3 top-3 w-7 h-7 border-l-2 border-t-2 border-cyan-300/70 rounded-tl-lg" style="animation-delay:.15s"></span>
                    <span class="hw-bracket absolute right-3 top-3 w-7 h-7 border-r-2 border-t-2 border-cyan-300/70 rounded-tr-lg" style="animation-delay:.3s"></span>
                    <span class="hw-bracket absolute left-3 bottom-3 w-7 h-7 border-l-2 border-b-2 border-cyan-300/70 rounded-bl-lg" style="animation-delay:.45s"></span>
                    <span class="hw-bracket absolute right-3 bottom-3 w-7 h-7 border-r-2 border-b-2 border-cyan-300/70 rounded-br-lg" style="animation-delay:.6s"></span>
                  </div>

                  <!-- floating spec chips -->
                  @for (s of it.specs; track s; let k = $index) {
                    <span class="hw-chip absolute font-mono text-[11px] tracking-wider text-cyan-100 bg-slate-900/70 ring-1 ring-cyan-300/30 rounded-full px-3 py-1 backdrop-blur-sm shadow-lg shadow-cyan-500/10"
                          [class]="chipPos[k]">{{ s }}</span>
                  }
                </div>

                <!-- angle thumbnails -->
                <div class="mt-7 flex justify-center gap-3">
                  <button type="button" (mouseenter)="setHero(i, it.main)" (focus)="setHero(i, it.main)"
                          class="w-16 h-12 rounded-lg overflow-hidden ring-1 transition-all"
                          [class]="heroOf(i) === it.main ? 'ring-cyan-400' : 'ring-white/15 opacity-60 hover:opacity-100'">
                    <img [src]="it.main" alt="" loading="lazy" decoding="async" class="w-full h-full object-cover" />
                  </button>
                  @for (a of it.angles; track a) {
                    <button type="button" (mouseenter)="setHero(i, a)" (focus)="setHero(i, a)"
                            class="w-16 h-12 rounded-lg overflow-hidden ring-1 transition-all"
                            [class]="heroOf(i) === a ? 'ring-cyan-400' : 'ring-white/15 opacity-60 hover:opacity-100'">
                      <img [src]="a" alt="" loading="lazy" decoding="async" class="w-full h-full object-cover" />
                    </button>
                  }
                </div>
              </div>

              <!-- CONTENT -->
              <div [class.lg:order-1]="i % 2 === 1">
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
  /** Which hero image is active per row index (defaults to each item's main). */
  private readonly hero = signal<Record<number, string>>({});

  /** Absolute placement classes for up to four floating spec chips. */
  protected readonly chipPos = [
    '-top-3 right-6 sm:-right-4',
    'top-1/3 -left-3 sm:-left-6',
    'bottom-1/4 -right-3 sm:-right-7',
    '-bottom-3 left-8',
  ];

  protected heroOf(i: number): string {
    return this.hero()[i] ?? this.items[i].main;
  }
  protected setHero(i: number, src: string): void {
    this.hero.update((m) => ({ ...m, [i]: src }));
  }

  /** Tilt the stage toward the pointer (desktop polish; no-op without a pointer). */
  protected tilt(e: PointerEvent): void {
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty('--ry', `${px * 12}deg`);
    el.style.setProperty('--rx', `${-py * 12}deg`);
  }
  protected resetTilt(e: PointerEvent): void {
    const el = e.currentTarget as HTMLElement;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  }

  protected readonly items: HardwareItem[] = [
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
  ];
}
