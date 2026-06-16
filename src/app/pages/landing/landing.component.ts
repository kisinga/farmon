import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
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
  MktButtonComponent,
  MktIconChipComponent,
  MktFeatureGridComponent,
  MktMetricBandComponent,
  MktTestimonialComponent,
  type MktFeatureItem,
  type MktMetric,
} from '../../shared/marketing/ui';
import { LiveDashboardComponent } from '../../shared/marketing/modules/live-dashboard.component';
import { PRICING, kes } from '../pricing/pricing.model';

/** A short "what you can do with it" capability. */
interface Capability {
  title: string;
  body: string;
}

/** An industry MajiFlow fits, with a one-line use. */
interface Vertical {
  title: string;
  body: string;
}

/** A real built site: the design we drew, next to a photo of it installed. */
interface Deployment {
  title: string;
  body: string;
  /** Topology render path under public/; '' shows the design placeholder. */
  design: string;
  /** Field install photo path under public/; '' shows the photo placeholder. */
  photo: string;
  /** Filename hint shown in the empty design slot. */
  designSlot: string;
  /** Filename hint shown in the empty photo slot. */
  photoSlot: string;
}

/**
 * Public landing page (route `''`). Renders full-bleed; the app shell hides its
 * chrome on this route, so this component owns the nav, scroll, and footer.
 * Prerendered to static HTML at build time (see app.routes.server.ts) so search
 * and social crawlers get the full page.
 *
 * Built on the marketing design system (src/app/shared/marketing/ui + the .mkt-*
 * recipes in styles.css) so it stays in lockstep with /features and /pricing.
 * Carries the brand-level story (design → set up → monitor, the verticals, the
 * use-cases): the hosted platform is the product, sold as a per-controller
 * monthly subscription plus a one-time near-cost hardware kit. The controller
 * stays autonomous on link loss — local control works without the subscription.
 */
@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [
    RouterLink,
    HardwareShowcaseComponent,
    MarketingNavComponent,
    MarketingFooterComponent,
    MarketingCtaComponent,
    MktHeroComponent,
    MktSectionComponent,
    MktButtonComponent,
    MktIconChipComponent,
    MktFeatureGridComponent,
    MktMetricBandComponent,
    MktTestimonialComponent,
    LiveDashboardComponent,
  ],
  host: { class: 'flex-1 overflow-y-auto bg-white text-slate-900' },
  template: `
    <!-- ============================= NAV ============================= -->
    <app-marketing-nav />

    <!-- ============================= HERO ============================= -->
    <mkt-hero size="lg" [blobs]="true" [logo]="true" [waveDivider]="true">
      <span class="mkt-eyebrow mb-6">
        <span class="w-1.5 h-1.5 rounded-full bg-cyan-300"></span> Water monitoring and automation
      </span>
      <h1 class="mkt-h1">
        Watch and control your
        <span class="bg-gradient-to-r from-cyan-300 via-sky-300 to-blue-300 bg-clip-text text-transparent">water</span>,
        from anywhere.
      </h1>
      <p class="mt-7 mkt-lead text-white/70 max-w-2xl mx-auto">
        Water is money, and untracked water is money gone. MajiFlow meters every litre, runs your pumps
        and valves on a schedule or to an exact volume, and shows where it all goes: by field, by tank,
        by customer. No more checking tanks by hand or driving out to start a pump.
      </p>
      <div class="mt-9 flex flex-wrap gap-3 justify-center">
        <mkt-button variant="primary" route="/pricing">Estimate your site</mkt-button>
        <mkt-button variant="ghost" route="/login">Get started</mkt-button>
      </div>
      <p class="mt-6 text-xs text-white/45">
        Your controllers keep working on their own, whether the internet is up or not.
      </p>
    </mkt-hero>

    <!-- ===================== LIVE DASHBOARD ===================== -->
    <mkt-section
      heading="See every tank, pump and valve on one screen"
      subhead="Live tank levels, water flow and valve positions in a single view. Watch your farm or site from your laptop or your phone, on-site or across the country.">
      <div class="max-w-3xl sm:max-w-4xl mx-auto">
        <mkt-live-dashboard />
      </div>
    </mkt-section>

    <!-- ===================== PROOF METRICS ===================== -->
    <!-- PLACEHOLDER figures — replace with real numbers before launch. -->
    <mkt-metric-band [metrics]="metrics" />

    <!-- ===================== SAVE WATER (CONSERVATION) ===================== -->
    <mkt-section [tint]="true"
      heading="Water you can see is water you don't waste"
      subhead="On a farm, every litre counts. Most water is lost where no one is looking. A valve left open, a tank overflowing at night, a slow leak underground. MajiFlow puts a number on all of it.">
      <mkt-feature-grid [items]="conservation" [cols]="4" titleTone="brand" />
    </mkt-section>

    <!-- ===================== SOFTWARE + HARDWARE ===================== -->
    <mkt-section heading="Software and hardware, designed together">
      <div class="grid gap-5 md:grid-cols-2">
        <div class="mkt-card-muted">
          <mkt-icon-chip tone="cyan" class="mb-4">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          </mkt-icon-chip>
          <h3 class="text-lg font-semibold">The software</h3>
          <p class="mt-2 text-sm text-slate-600 leading-relaxed">Draw your tanks, pumps and sensors on the screen. MajiFlow checks your design and flags wiring mistakes <em>before</em> you spend a shilling, then gets the controllers and your dashboard ready.</p>
        </div>
        <div class="mkt-card-muted">
          <mkt-icon-chip tone="sky" class="mb-4">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          </mkt-icon-chip>
          <h3 class="text-lg font-semibold">The hardware</h3>
          <p class="mt-2 text-sm text-slate-600 leading-relaxed">Off-the-shelf controllers, sensors, pumps and valves. No special parts to hunt down. A plumber can do most of the install, and an electrician handles the pump wiring. Everything is documented.</p>
        </div>
      </div>
      <!-- the controller itself, on the cinematic hardware stage -->
      <app-hardware-showcase class="block mt-8" variant="hero" [devices]="heroDevices" [showHeader]="false" />
      <div class="mt-6 text-center">
        <mkt-button variant="link" route="/features">See the full hardware lineup →</mkt-button>
      </div>
    </mkt-section>

    <!-- ===================== DESIGN / SET UP / MONITOR ===================== -->
    <mkt-section [tint]="true">
      <div class="grid gap-6 sm:grid-cols-3">
        <div class="text-center sm:text-left">
          <mkt-icon-chip tone="on-light" class="mx-auto sm:mx-0 mb-4">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </mkt-icon-chip>
          <h3 class="font-semibold">1. Design it</h3>
          <p class="mt-1.5 text-sm text-slate-600 leading-relaxed">Lay out your tanks, pumps, valves and sensors on the screen. We check it and catch mistakes before you spend money.</p>
        </div>
        <div class="text-center sm:text-left">
          <mkt-icon-chip tone="on-light" class="mx-auto sm:mx-0 mb-4">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
          </mkt-icon-chip>
          <h3 class="font-semibold">2. We set it up</h3>
          <p class="mt-1.5 text-sm text-slate-600 leading-relaxed">We get your controllers ready to switch on, build your dashboard, and write the wiring guide. No coding, ever.</p>
        </div>
        <div class="text-center sm:text-left">
          <mkt-icon-chip tone="on-light" class="mx-auto sm:mx-0 mb-4">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
          </mkt-icon-chip>
          <h3 class="font-semibold">3. You watch it</h3>
          <p class="mt-1.5 text-sm text-slate-600 leading-relaxed">See tank levels, water flow and valve positions in one place. Know what your farm is doing even when you are miles away.</p>
        </div>
      </div>
    </mkt-section>

    <!-- ===================== WHAT YOU CAN DO ===================== -->
    <mkt-section heading="What you can do with it">
      <mkt-feature-grid [items]="capabilities" [cols]="2" tone="muted" [interactive]="true" />
      <div class="mt-8 text-center">
        <mkt-button variant="link" route="/features">See everything MajiFlow does →</mkt-button>
      </div>
    </mkt-section>

    <!-- ===================== FROM DESIGN TO THE FIELD ===================== -->
    <mkt-section [tint]="true" width="wide"
      heading="From design to the field"
      subhead="Real sites we have planned and built. The same layout you draw on the screen becomes the controllers, pumps and valves running on the ground.">
      <div class="grid gap-6 md:grid-cols-3">
        @for (d of deployments; track d.title) {
          <div class="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm overflow-hidden">
            <!-- the design (topology render) -->
            <div class="bg-white border-b border-slate-100">
              @if (d.design) {
                <img [src]="d.design" [alt]="d.title + ' design'"
                     width="1000" height="741" loading="lazy" decoding="async"
                     class="block w-full aspect-[16/10] object-contain bg-slate-50" />
              } @else {
                <div class="aspect-[16/10] bg-slate-50 flex flex-col items-center justify-center gap-1.5 text-slate-400">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                  <span class="text-[10px] font-medium">{{ d.designSlot }}</span>
                </div>
              }
            </div>
            <!-- the install (real field photo) -->
            @if (d.photo) {
              <img [src]="d.photo" [alt]="d.title + ' installed'" class="block w-full aspect-[16/10] object-cover" />
            } @else {
              <div class="aspect-[16/10] bg-slate-100 flex flex-col items-center justify-center gap-1.5 text-slate-400">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.5-3.5L9 20"/></svg>
                <span class="text-[10px] font-medium">{{ d.photoSlot }}</span>
              </div>
            }
            <div class="p-5">
              <h3 class="font-semibold text-slate-900">{{ d.title }}</h3>
              <p class="mt-1.5 text-sm text-slate-600 leading-relaxed">{{ d.body }}</p>
            </div>
          </div>
        }
      </div>
    </mkt-section>

    <!-- ===================== WORKS IN ===================== -->
    <mkt-section heading="Water monitoring for farms, hotels, greenhouses and boreholes">
      <mkt-feature-grid [items]="verticals" [cols]="4" tone="muted" titleTone="brand" />
    </mkt-section>

    <!-- ===================== PRICING ===================== -->
    <mkt-section [tint]="true" width="narrow"
      heading="Simple, honest pricing"
      subhead="Pay monthly for the platform. Add a one-time kit to run it. Nothing hidden, no lock-in.">
      <div class="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-7 sm:p-9 max-w-2xl mx-auto">
        <p class="text-xs font-semibold uppercase tracking-wider text-cyan-600">Hosted by us</p>
        <h3 class="mt-1 text-xl font-bold">The platform</h3>
        <p class="mt-2 text-sm text-slate-600 leading-relaxed">
          One app for your whole water system, reachable from anywhere. Alerts, automation and usage
          history. We host it and keep it running.
        </p>

        <!-- Monthly subscription, by tier -->
        <div class="mt-6">
          <div class="flex items-baseline justify-between">
            <p class="text-sm font-semibold text-slate-900">Monthly, per controller</p>
            <p class="text-xs text-slate-400">graduated</p>
          </div>
          <ul class="mt-3 divide-y divide-slate-100">
            @for (t of tiers; track t.name) {
              <li class="flex items-center justify-between py-2.5">
                <span class="text-sm text-slate-700">{{ t.name }} <span class="text-slate-400">· {{ t.range }}</span></span>
                <span class="text-sm font-semibold tabular-nums">{{ money(t.rate) }} <span class="font-normal text-slate-400">{{ t.suffix }}</span></span>
              </li>
            }
          </ul>
          <p class="mt-2 text-xs text-slate-500 leading-relaxed">More controllers, less each. Adding tanks, valves or flow to a controller never raises the monthly.</p>
        </div>

        <!-- One-time cost -->
        <div class="mt-6 pt-5 border-t border-slate-100">
          <p class="text-sm font-semibold text-slate-900">One-time, per site</p>
          <p class="mt-1 text-sm text-slate-600 leading-relaxed">The hardware kit, sold near cost, plus installation. Priced to your site after a quick survey.</p>
        </div>

        <!-- What the platform includes -->
        <ul class="mt-6 space-y-2.5 text-sm">
          @for (f of platformIncludes; track f) {
            <li class="flex gap-2.5">
              <svg class="shrink-0 mt-0.5 text-cyan-500" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              <span class="text-slate-700">{{ f }}</span>
            </li>
          }
        </ul>

        <p class="mt-5 pt-4 border-t border-slate-100 text-xs text-slate-500 leading-relaxed">
          No lock-in: on-site your controllers keep working without the subscription. Local control, pump
          safety and saved automations run on their own.
        </p>

        <a routerLink="/pricing"
           class="mt-6 block text-center rounded-full px-5 py-2.5 text-sm font-semibold bg-cyan-500 text-white hover:bg-cyan-400 transition-colors">
          Estimate your site
        </a>
      </div>
    </mkt-section>

    <!-- ===================== RESILIENCE BAND ===================== -->
    <mkt-section [dark]="true"
      heading="Built to keep going"
      subhead="Water cannot wait, and neither can a thirsty crop. Your site keeps running even when things go wrong.">
      <div class="grid gap-6 sm:grid-cols-3 text-left">
        <div class="mkt-card-dark">
          <mkt-icon-chip tone="on-dark" size="sm" class="mb-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
          </mkt-icon-chip>
          <h3 class="font-semibold">Battery and solar</h3>
          <p class="mt-1.5 text-sm text-white/60 leading-relaxed">Add battery and solar and your site runs right through a power cut, cleaner and cheaper than a diesel pump.</p>
        </div>
        <div class="mkt-card-dark">
          <mkt-icon-chip tone="on-dark" size="sm" class="mb-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.86a10 10 0 0 1 14 0"/><path d="M8.5 16.43a5 5 0 0 1 7 0"/></svg>
          </mkt-icon-chip>
          <h3 class="font-semibold">Works offline, even unsubscribed</h3>
          <p class="mt-1.5 text-sm text-white/60 leading-relaxed">On-site, local control, pump safety and your saved automations keep running with no internet and no subscription. The plan adds the offsite half: remote access, graphs, alerts, and automations you build online.</p>
        </div>
        <div class="mkt-card-dark">
          <mkt-icon-chip tone="on-dark" size="sm" class="mb-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>
          </mkt-icon-chip>
          <h3 class="font-semibold">We keep it online</h3>
          <p class="mt-1.5 text-sm text-white/60 leading-relaxed">Choose the hosted plan and we run everything online and keep it up, so there is nothing for you to manage.</p>
        </div>
      </div>
    </mkt-section>

    <!-- ===================== TESTIMONIAL ===================== -->
    <!-- PLACEHOLDER quote — replace with a real customer quote before launch. -->
    <mkt-testimonial
      quote="The borehole used to run dry before anyone noticed. Now it switches on by itself and I watch the tanks from my phone in town. I have not driven out at night in months."
      author="James Mwangi"
      role="Borehole on solar · Laikipia" />

    <!-- ===================== CTA BAND ===================== -->
    <app-marketing-cta
      heading="Ready to plan your site?"
      blurb="Draw your farm or site on the screen, and we will get everything ready to build and run it."
      [buttons]="ctaButtons" />

    <!-- ===================== FOOTER ===================== -->
    <app-marketing-footer />
  `,
})
export class LandingComponent {
  constructor() {
    applyPageSeo({
      title: 'Water monitoring and control for farms, hotels and boreholes | MajiFlow',
      description:
        'Water monitoring and control for farms, hotels, greenhouses and boreholes. See tank levels, water flow, pumps and valves live, catch leaks early, and run your site from anywhere.',
      path: '',
    });
  }

  /** The controller, on the shared cinematic stage as a one-device hero. */
  protected readonly heroDevices = [HARDWARE_DEVICES[0]];

  protected readonly ctaButtons: CtaButton[] = [
    { label: 'Estimate your site', route: '/pricing' },
    { label: 'Get started', route: '/login' },
  ];

  /** Proof figures for the metric band. PLACEHOLDERS — swap for real numbers. */
  protected readonly metrics: MktMetric[] = [
    { value: '1.2M+', label: 'Litres metered' },
    { value: '40+', label: 'Sites running' },
    { value: '99.9%', label: 'Platform uptime' },
    { value: '30%', label: 'Avg. water saved' },
  ];

  protected money(n: number): string {
    return kes(n);
  }

  /** Monthly subscription tiers (per controller), with rates pulled from the pricing
   *  model so the landing and the estimator never disagree. */
  protected readonly tiers = [
    { name: 'Lite', range: '1 controller', rate: PRICING.subscription[0].rate, suffix: '/ mo' },
    { name: 'Plus', range: '2 to 4', rate: PRICING.subscription[1].rate, suffix: 'each / mo' },
    { name: 'Pro', range: '5 to 10', rate: PRICING.subscription[2].rate, suffix: 'each / mo' },
    { name: 'Scale', range: '11 or more', rate: PRICING.subscription[3].rate, suffix: 'each / mo' },
  ];

  protected readonly platformIncludes = [
    'Live dashboard, full history and instant alerts, on every device',
    'Automations you build online keep running on the controller, even offline',
    'Grow freely: more tanks, valves and flow per controller, then more controllers',
    'Hosted by us with an uptime guarantee',
  ];

  protected readonly conservation: MktFeatureItem[] = [
    { title: 'Catch leaks early', body: 'Flow sensors spot a line that should be still and warn you the same day, before it drains a tank or floods a field.' },
    { title: 'Use only what you need', body: 'Tanks fill to a set level and stop, so nothing overflows and no crop is over-watered.' },
    { title: 'Know your usage', body: '"Field A used 10,300 litres this week" turns guesswork into numbers you can plan around and cut.' },
    { title: 'Pump on sun, not diesel', body: 'Solar-run sites water the land on clean power and cut fuel, cost and carbon.' },
  ];

  protected readonly capabilities: Capability[] = [
    { title: 'Keep an eye from anywhere', body: 'Tank levels, water flow and valve positions in one dashboard, whether you are walking the farm or away in town.' },
    { title: 'Know how much you use', body: 'Field A used 10,300 litres this week. The main tank has held 85% for two days. See it all in one place.' },
    { title: 'Take action from your phone', body: 'Reservoir down to 8%? Switch on the borehole pump from your phone. No need to drive out to the farm.' },
    { title: 'Let the routine run itself', body: 'Water the field at 6 AM on Mondays, or whenever the tank drops below 30%. Set it once and forget it.' },
  ];

  protected readonly verticals: Vertical[] = [
    { title: 'Farms', body: 'Automatic irrigation and remote pump control, so every drop reaches the crop, on small plots and large commercial farms alike.' },
    { title: 'Hotels and lodges', body: 'Balanced tanks, steady water pressure, and early leak warnings for guest sites.' },
    { title: 'Greenhouses', body: 'Automatic feeding and dosing, with watering that follows the weather so plants get just what they need.' },
    { title: 'Remote sites', body: 'Solar-powered monitoring for boreholes, dams, and places with no grid power, and it keeps boreholes from being over-pumped.' },
  ];

  protected readonly deployments: Deployment[] = [
    {
      title: 'Dryland farm',
      body: 'Rain tank and borehole feeding two fields through a shared pump and valves.',
      design: 'marketing/deploy-1-design.webp',
      photo: '',
      designSlot: '',
      photoSlot: 'marketing/deploy-1-install.png',
    },
    {
      title: 'Hotel water store',
      body: 'Balanced storage tanks holding steady pressure, with early leak warnings.',
      design: '',
      photo: '',
      designSlot: 'marketing/deploy-2-design.png',
      photoSlot: 'marketing/deploy-2-install.png',
    },
    {
      title: 'Borehole on solar',
      body: 'Off-grid pumping and monitoring, solar powered, carrying on with no internet.',
      design: '',
      photo: '',
      designSlot: 'marketing/deploy-3-design.png',
      photoSlot: 'marketing/deploy-3-install.png',
    },
  ];
}
