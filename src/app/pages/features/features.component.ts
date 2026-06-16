import { Component } from '@angular/core';
import { applyPageSeo } from '../../shared/seo';
import {
  HardwareShowcaseComponent,
  HARDWARE_DEVICES,
} from '../../shared/hardware-showcase/hardware-showcase.component';
import { MarketingNavComponent } from '../../shared/marketing/marketing-nav.component';
import { MarketingFooterComponent } from '../../shared/marketing/marketing-footer.component';
import { MarketingCtaComponent, type CtaButton } from '../../shared/marketing/marketing-cta.component';
import {
  MktHeroComponent,
  MktSectionComponent,
  MktFeatureGridComponent,
} from '../../shared/marketing/ui';

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
  imports: [
    HardwareShowcaseComponent,
    MarketingNavComponent,
    MarketingFooterComponent,
    MarketingCtaComponent,
    MktHeroComponent,
    MktSectionComponent,
    MktFeatureGridComponent,
  ],
  host: { class: 'flex-1 overflow-y-auto bg-white text-slate-900' },
  template: `
    <!-- NAV -->
    <app-marketing-nav />

    <!-- HERO -->
    <mkt-hero size="md">
      <span class="mkt-eyebrow mb-6">
        <span class="w-1.5 h-1.5 rounded-full bg-cyan-300"></span> Water monitoring and automation
      </span>
      <h1 class="mkt-h1 text-3xl sm:text-5xl">Know where every drop goes, and let the rest run itself.</h1>
      <p class="mt-5 mkt-lead text-white/70 max-w-2xl mx-auto">
        MajiFlow meters your water, accounts for it by field, tank and customer, and runs your pumps
        and valves on a schedule or to an exact volume. Here is everything it does for your site.
      </p>
    </mkt-hero>

    <!-- FEATURE GROUPS -->
    @for (g of groups; track g.title) {
      <mkt-section align="left" [tint]="g.tint" [heading]="g.title" [subhead]="g.intro">
        <mkt-feature-grid [items]="g.items" [cols]="2" />
      </mkt-section>
    }

    <!-- HARDWARE (animated showcase) -->
    <app-hardware-showcase [devices]="devices" variant="full" />

    <!-- USE CASES -->
    <mkt-section [dark]="true" heading="Built for real sites"
      subhead="The same controllers and dashboard, put to work where water is money and labour.">
      <div class="grid gap-6 md:grid-cols-2">
        @for (u of useCases; track u.title) {
          <div class="mkt-card-dark">
            <h3 class="font-semibold text-cyan-300">{{ u.title }}</h3>
            <p class="mt-2 text-sm text-white/55 leading-relaxed italic">{{ u.scene }}</p>
            <p class="mt-3 text-sm text-white/80 leading-relaxed">{{ u.solution }}</p>
          </div>
        }
      </div>
    </mkt-section>

    <!-- CTA BAND -->
    <app-marketing-cta
      heading="See it on your own site"
      blurb="Answer three questions for a live estimate, or draw your site and we will get it ready to build."
      [buttons]="ctaButtons" />

    <!-- FOOTER -->
    <app-marketing-footer />
  `,
})
export class FeaturesComponent {
  protected readonly devices = HARDWARE_DEVICES;
  protected readonly ctaButtons: CtaButton[] = [
    { label: 'See what your site costs', route: '/pricing' },
    { label: 'Get started', route: '/login' },
  ];

  constructor() {
    applyPageSeo({
      title: 'Features | water metering, monitoring and irrigation automation | MajiFlow',
      description:
        'Meter every litre and see where your water goes by field, tank and customer. Automate pumps and valves by volume or schedule, catch leaks and losses, and run it all from anywhere.',
      path: 'features',
    });
  }

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
        { title: 'Runs without internet or a subscription', body: 'On-site, each controller follows its own schedule and safety checks with no internet and no subscription. The plan is for watching and controlling from afar.' },
        { title: 'Saves water by default', body: 'Tanks stop at a set level and leaks raise a flag, so nothing overflows or drains away unseen.' },
        { title: 'Grows with the site', body: 'Fill one controller, add tanks by the wire with a metering hub, or drop in another controller for a far cluster. Every controller shows in one dashboard.' },
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
