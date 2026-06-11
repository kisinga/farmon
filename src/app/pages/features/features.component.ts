import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { BRAND_LOGO_SVG } from '../../shared/brand-logo';
import { applyPageSeo } from '../../shared/seo';

const GITHUB_URL = 'https://github.com/kisinga/majiflow';

/** A capability group: one keyword-bearing heading and the things under it. */
interface FeatureGroup {
  title: string;
  intro: string;
  /** Alternate the section background for rhythm. */
  tint: boolean;
  items: { title: string; body: string }[];
}

/** A real site situation, in the buyer's words, with how MajiFlow answers it. */
interface UseCase {
  title: string;
  scene: string;
  solution: string;
}

/** A physical hardware component shown in the interlacing gallery. */
interface HardwareItem {
  name: string;
  body: string;
  /** Image path under public/; '' renders a 'photo coming' placeholder. */
  image: string;
}

/**
 * Public features page (route `/features`). Prerendered to static HTML so each
 * capability heading can rank for its own long-tail term (water metering, usage
 * tracking, irrigation automation, remote pump control). Full-bleed with its own
 * nav/footer, like the landing and pricing pages; the app shell hides its chrome.
 *
 * The story is monitoring (meter every drop, account for it, catch loss and
 * theft) plus automation (deliver by volume or schedule, unattended), grounded
 * in real hotel / farm / water-seller / irrigation situations.
 */
@Component({
  selector: 'app-features',
  standalone: true,
  imports: [RouterLink],
  host: { class: 'flex-1 overflow-y-auto bg-white text-slate-900' },
  styles: [`
    @keyframes reveal-in { from { opacity: 0; transform: translateY(28px); } to { opacity: 1; transform: none; } }
    /* Scroll-driven entry, only where supported, so SSR / no-JS / older browsers
       keep the content visible by default (no opacity:0 fallback). */
    @supports (animation-timeline: view()) {
      .reveal { animation: reveal-in linear both; animation-timeline: view(); animation-range: entry 0% entry 45%; }
    }
    @media (prefers-reduced-motion: reduce) {
      .reveal { animation: none; opacity: 1; transform: none; }
    }
  `],
  template: `
    <!-- NAV -->
    <nav class="sticky top-0 z-30 backdrop-blur-sm bg-slate-950/85 border-b border-white/10">
      <div class="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
        <a routerLink="/" class="flex items-center gap-2.5">
          <span class="w-8 h-8 block" [innerHTML]="logo"></span>
          <span class="text-lg font-bold tracking-tight text-white">MajiFlow</span>
        </a>
        <div class="flex items-center gap-2 sm:gap-3">
          <a routerLink="/pricing"
             class="text-sm font-medium text-white/70 hover:text-white transition-colors px-3 py-2">Pricing</a>
          <a [href]="github" target="_blank" rel="noopener"
             class="hidden sm:inline-flex text-sm font-medium text-white/70 hover:text-white transition-colors px-3 py-2">GitHub</a>
          <a routerLink="/login"
             class="text-sm font-semibold rounded-full px-4 py-2 bg-cyan-400 text-slate-950 hover:bg-cyan-300 transition-colors">Sign in</a>
        </div>
      </div>
    </nav>

    <!-- HERO -->
    <header class="bg-slate-950 text-white px-5 sm:px-8 pt-16 pb-14 text-center">
      <span class="inline-flex items-center gap-2 rounded-full bg-white/10 ring-1 ring-white/15 px-3 py-1 text-xs font-medium text-cyan-200 mb-6">
        <span class="w-1.5 h-1.5 rounded-full bg-cyan-300"></span> Water monitoring and automation
      </span>
      <h1 class="text-3xl sm:text-5xl font-bold tracking-tight leading-[1.05]">Know where every drop goes, and let the rest run itself.</h1>
      <p class="mt-5 text-base sm:text-xl text-white/70 max-w-2xl mx-auto leading-relaxed">
        MajiFlow meters your water, accounts for it by field, tank and customer, and runs your pumps
        and valves on a schedule or to an exact volume. Here is everything it does for your site.
      </p>
    </header>

    <!-- FEATURE GROUPS -->
    @for (g of groups; track g.title) {
      <section class="px-5 sm:px-8 py-16 sm:py-20" [class.bg-slate-50]="g.tint">
        <div class="max-w-5xl mx-auto">
          <div class="max-w-2xl">
            <h2 class="text-2xl sm:text-3xl font-bold tracking-tight">{{ g.title }}</h2>
            <p class="mt-3 text-sm sm:text-base text-slate-600 leading-relaxed">{{ g.intro }}</p>
          </div>
          <div class="mt-10 grid gap-5 sm:grid-cols-2">
            @for (it of g.items; track it.title) {
              <div class="rounded-xl p-6 bg-white ring-1 ring-slate-200">
                <h3 class="font-semibold text-slate-900">{{ it.title }}</h3>
                <p class="mt-1.5 text-sm text-slate-600 leading-relaxed">{{ it.body }}</p>
              </div>
            }
          </div>
        </div>
      </section>
    }

    <!-- HARDWARE (interlacing image/text rows) -->
    <section class="px-5 sm:px-8 py-16 sm:py-20 bg-slate-50">
      <div class="max-w-5xl mx-auto">
        <div class="text-center max-w-2xl mx-auto">
          <h2 class="text-2xl sm:text-3xl font-bold tracking-tight">The hardware, up close</h2>
          <p class="mt-3 text-sm sm:text-base text-slate-600 leading-relaxed">
            Off-the-shelf parts a plumber can fit. Here is what goes on the wall and in the line.
          </p>
        </div>
        <div class="mt-14 space-y-16 sm:space-y-24">
          @for (h of hardware; track h.name; let i = $index) {
            <div class="reveal flex flex-col gap-6 sm:gap-10 items-center md:flex-row"
                 [class.md:flex-row-reverse]="i % 2 === 1">
              <div class="w-full md:w-1/2">
                @if (h.image) {
                  <div class="rounded-2xl ring-1 ring-slate-200 shadow-xl shadow-slate-900/10 overflow-hidden bg-white">
                    <picture>
                      <source [srcset]="avif(h.image)" type="image/avif" />
                      <source [srcset]="webp(h.image)" type="image/webp" />
                      <img [src]="h.image" [alt]="h.name"
                           width="1400" height="787" loading="lazy" decoding="async"
                           class="block w-full aspect-[16/10] object-cover" />
                    </picture>
                  </div>
                } @else {
                  <div class="rounded-2xl ring-1 ring-slate-200 bg-white aspect-[16/10] flex flex-col items-center justify-center gap-2 text-slate-400">
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.5-3.5L9 20"/></svg>
                    <span class="text-xs font-medium">Photo coming</span>
                  </div>
                }
              </div>
              <div class="w-full md:w-1/2">
                <h3 class="text-xl font-bold tracking-tight text-slate-900">{{ h.name }}</h3>
                <p class="mt-3 text-sm sm:text-base text-slate-600 leading-relaxed">{{ h.body }}</p>
              </div>
            </div>
          }
        </div>
      </div>
    </section>

    <!-- USE CASES -->
    <section class="px-5 sm:px-8 py-16 sm:py-20 bg-slate-950 text-white">
      <div class="max-w-5xl mx-auto">
        <div class="text-center max-w-2xl mx-auto">
          <h2 class="text-2xl sm:text-3xl font-bold tracking-tight">Built for real sites</h2>
          <p class="mt-3 text-white/60 text-sm sm:text-base leading-relaxed">
            The same controllers and dashboard, put to work where water is money and labour.
          </p>
        </div>
        <div class="mt-12 grid gap-6 md:grid-cols-2">
          @for (u of useCases; track u.title) {
            <div class="rounded-2xl bg-white/5 ring-1 ring-white/10 p-6">
              <h3 class="font-semibold text-cyan-300">{{ u.title }}</h3>
              <p class="mt-2 text-sm text-white/55 leading-relaxed italic">{{ u.scene }}</p>
              <p class="mt-3 text-sm text-white/80 leading-relaxed">{{ u.solution }}</p>
            </div>
          }
        </div>
      </div>
    </section>

    <!-- CTA BAND -->
    <section class="px-5 sm:px-8 py-20">
      <div class="max-w-4xl mx-auto rounded-3xl bg-gradient-to-br from-cyan-500 via-sky-600 to-blue-700 px-8 py-14 text-center text-white shadow-2xl shadow-cyan-500/20">
        <h2 class="text-2xl sm:text-4xl font-bold tracking-tight">See it on your own site</h2>
        <p class="mt-3 text-white/85 max-w-xl mx-auto">Answer three questions for a live estimate, or draw your site and we will get it ready to build.</p>
        <div class="mt-8 flex flex-wrap gap-3 justify-center">
          <a routerLink="/pricing" class="rounded-full px-6 py-3 text-sm font-semibold bg-white text-slate-900 hover:bg-slate-100 transition-colors">See what your site costs</a>
          <a routerLink="/login" class="rounded-full px-6 py-3 text-sm font-semibold ring-1 ring-white/40 text-white hover:bg-white/10 transition-colors">Get started</a>
        </div>
      </div>
    </section>

    <!-- FOOTER -->
    <footer class="bg-slate-950 text-slate-400 px-5 sm:px-8 py-10">
      <div class="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <a routerLink="/" class="flex items-center gap-2.5">
          <span class="w-6 h-6 block" [innerHTML]="logo"></span>
          <span class="font-semibold text-white">MajiFlow</span>
        </a>
        <p class="text-sm text-center">Started on a dry-land farm, where every drop counts.</p>
        <a routerLink="/" class="text-sm hover:text-white transition-colors">← Back to home</a>
      </div>
    </footer>
  `,
})
export class FeaturesComponent {
  protected readonly github = GITHUB_URL;
  protected readonly logo: SafeHtml = inject(DomSanitizer).bypassSecurityTrustHtml(BRAND_LOGO_SVG);

  constructor() {
    applyPageSeo({
      title: 'Features | water metering, monitoring and irrigation automation | MajiFlow',
      description:
        'Meter every litre and see where your water goes by field, tank and customer. Automate pumps and valves by volume or schedule, catch leaks and losses, and run it all from anywhere.',
      path: 'features',
    });
  }

  // Modern-format siblings for <picture> (see landing.component.ts).
  protected avif(src: string): string {
    return src.replace(/\.(png|jpe?g)$/i, '.avif');
  }
  protected webp(src: string): string {
    return src.replace(/\.(png|jpe?g)$/i, '.webp');
  }

  protected readonly hardware: HardwareItem[] = [
    {
      name: 'The controller',
      body: 'The brain on the wall. It reads your sensors, switches your pumps and valves, and reports back to your dashboard. Off-the-shelf and rail-mounted, wired once and left alone.',
      image: 'marketing/controller.jpg',
    },
    {
      name: 'Motorised valve',
      body: 'Opens and closes a water line on its own, on a schedule or on command. No one has to stand at the tap to start or stop a zone.',
      image: '',
    },
    {
      name: 'Flow sensor',
      body: 'Counts every litre that passes, so the water you use, sell or lose turns into real numbers you can act on.',
      image: '',
    },
    {
      name: 'Pressure sensor',
      body: 'Keeps an eye on line pressure and flags a blockage or a burst before it becomes a flood.',
      image: '',
    },
  ];

  protected readonly groups: FeatureGroup[] = [
    {
      title: 'Measure every drop',
      intro: "Water you can't measure is water you can't manage, or charge for. MajiFlow puts an accurate number on every line.",
      tint: false,
      items: [
        { title: 'Accurate flow metering', body: 'Digital flow sensors count every litre through a line, far tighter than a manual meter or a glance at the tank.' },
        { title: 'Usage by purpose', body: 'Split domestic, irrigation and sold water onto their own meters, so you see what each one really uses.' },
        { title: 'By field, tank or customer', body: 'See levels and usage per field, per tank and per outlet, not one blurred number for the whole site.' },
        { title: 'History you can trust', body: 'Every reading is logged. Pull up last week, last month, or the night a tank ran empty.' },
      ],
    },
    {
      title: 'Automate water delivery',
      intro: 'Tell MajiFlow what you want delivered and it runs the pumps and valves to make it happen, with no one standing by.',
      tint: true,
      items: [
        { title: 'Deliver by volume', body: 'Send exactly 5,000 litres to a field or a tank, then stop. No overflow, no guesswork.' },
        { title: 'Deliver by time', body: 'Run a line for 30 minutes, or until a tank reaches a set level. Your rule, kept every time.' },
        { title: 'Cycle through zones', body: 'Water field A, then B, then C in turn, on the schedule you set, even at 3am.' },
        { title: 'Triggers and schedules', body: 'Fill the reservoir at 6am, or whenever it drops below 30%. Set it once and leave it.' },
      ],
    },
    {
      title: 'Watch and control from anywhere',
      intro: 'One dashboard for the whole site, on your laptop or your phone, on-site or across the country.',
      tint: false,
      items: [
        { title: 'Live dashboard', body: 'Tank levels, water flow and valve positions, updating live in a single view.' },
        { title: 'Control from your phone', body: 'Open a valve or start a pump from wherever you are. No drive out to the site.' },
        { title: 'Alerts when it matters', body: 'Get warned about a leak, a dry-running pump or a tank about to empty, the moment it happens.' },
        { title: 'Catch losses and theft', body: 'Reconcile what left the borehole against what was sold, and spot the litres that go missing.' },
      ],
    },
    {
      title: 'Built to keep going',
      intro: "Water can't wait for the power or the internet to come back. Your site keeps running regardless.",
      tint: true,
      items: [
        { title: 'Works off-grid', body: 'Battery and solar keep the controllers and pumps running straight through a power cut.' },
        { title: 'Runs without internet', body: 'Each controller follows its own schedule and safety checks on its own. The internet is just for watching from afar.' },
        { title: 'Saves water by default', body: 'Tanks stop at a set level and leaks raise a flag, so nothing overflows or drains away unseen.' },
        { title: 'Grows with the site', body: 'Add controllers as you grow and they all work together in the same dashboard.' },
      ],
    },
  ];

  protected readonly useCases: UseCase[] = [
    {
      title: "A hotel that can't run dry",
      scene: 'Someone walks the tanks every morning and switches the pump by hand. Miss it once and guests have no water.',
      solution: 'MajiFlow keeps tanks topped to a set level on its own, warns you before they run low, and shows the water was always there.',
    },
    {
      title: "The farm you can't get to",
      scene: 'Water splits between the house, the fields and what you sell, and none of it is tracked, so money quietly leaks.',
      solution: 'Meter each line on its own and see domestic, irrigation and sold water apart, per field and per tank.',
    },
    {
      title: 'Selling water you can account for',
      scene: 'Bowsers carry more than the label says, manual meters are weak, and a driver can sell the extra on the side.',
      solution: 'Meter every fill to the litre and reconcile what was sold against what left the borehole, so the missing water shows up.',
    },
    {
      title: 'Irrigation while you sleep',
      scene: 'Deliver 5,000 litres to field A, then B, then C, or run each for 30 minutes at 3am. Hard for a person to get right, night after night.',
      solution: 'Set a volume or a time per zone and let it cycle on its own, with the pump protected from running dry.',
    },
  ];
}
