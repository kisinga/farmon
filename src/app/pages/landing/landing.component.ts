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
  MktButtonComponent,
  MktIconChipComponent,
  MktFeatureGridComponent,
  MktPlanLevelsComponent,
  type MktFeatureItem,
} from '../../shared/marketing/ui';
import { LiveDashboardComponent } from '../../shared/marketing/modules/live-dashboard.component';

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
    HardwareShowcaseComponent,
    MarketingNavComponent,
    MarketingFooterComponent,
    MarketingCtaComponent,
    MktHeroComponent,
    MktSectionComponent,
    MktButtonComponent,
    MktIconChipComponent,
    MktFeatureGridComponent,
    MktPlanLevelsComponent,
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
        Water is money, and untracked water is money gone. MajiFlow meters every litre and runs your
        pumps and valves to the exact volume you set. No more checking tanks by hand or driving out to
        start a pump.
      </p>
      <div class="mt-9 flex flex-wrap gap-3 justify-center">
        <mkt-button variant="primary" route="/pricing">Estimate your site</mkt-button>
        <mkt-button variant="ghost" route="/login">Sign in</mkt-button>
      </div>
      <p class="mt-6 text-xs text-white/45">
        Your controller runs on its own, online or not. The cloud is what brings it to your phone.
      </p>
    </mkt-hero>

    <!-- ===================== SEE HOW IT WORKS (teaser → /how-it-works) ===================== -->
    <mkt-section
      heading="See your whole system work, end to end"
      subhead="From a tap on your phone to water in the field: the dashboard, the platform, the controller’s on-device safety checks, the valve and pump, real measured flow, and the reading back. Watch the whole journey play out.">
      <div class="max-w-3xl sm:max-w-4xl mx-auto">
        <mkt-live-dashboard />
      </div>
      <div class="mt-8 text-center">
        <mkt-button variant="primary" route="/how-it-works">Watch how it works →</mkt-button>
      </div>
    </mkt-section>

    <!-- ===================== WHAT YOU CAN DO / SAVE WATER ===================== -->
    <mkt-section [tint]="true"
      heading="Water you can see is water you don't waste"
      subhead="Most water is lost where no one is looking: a valve left open, a tank overflowing at night, a slow leak underground. MajiFlow puts a number on all of it, and lets you act on it.">
      <mkt-feature-grid [items]="capabilities" [cols]="3" tone="muted" titleTone="brand" [interactive]="true" />
      <div class="mt-8 text-center">
        <mkt-button variant="link" route="/features">See everything MajiFlow does →</mkt-button>
      </div>
    </mkt-section>

    <!-- ===================== SOFTWARE + HARDWARE ===================== -->
    <mkt-section
      heading="Software and hardware, designed together"
      subhead="One system, end to end: the app, the controllers, and off-the-shelf parts a plumber and electrician can install. No coding. You design it on the screen, we set it up, and you run it from the farm or from town.">
      <!-- the controller itself, on the cinematic hardware stage -->
      <app-hardware-showcase class="block" variant="hero" [devices]="heroDevices" [showHeader]="false" />
      <div class="mt-6 text-center">
        <mkt-button variant="link" route="/features">See the full hardware lineup →</mkt-button>
      </div>
    </mkt-section>

    <!-- ===================== FROM DESIGN TO THE FIELD ===================== -->
    <mkt-section [tint]="true" width="wide"
      heading="From design to the field"
      subhead="Those same three steps, on real sites we have planned and built. The layout on your screen, now the pumps and valves running on the ground.">
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
    <mkt-section [tint]="true"
      heading="Simple, honest pricing"
      subhead="One monthly subscription per controller, plus a one-time kit sold near cost. Start with everything a single site needs and add more as you grow. No lock-in.">
      <mkt-plan-levels [compact]="true" />
      <div class="mt-8 text-center">
        <mkt-button variant="primary" route="/pricing">Estimate your site</mkt-button>
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
          <h3 class="font-semibold">Runs on its own, subscription or not</h3>
          <p class="mt-1.5 text-sm text-white/60 leading-relaxed">Local control, pump safety and saved automations keep running with no internet and no subscription. The plan adds the view from anywhere, not the water itself.</p>
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
    <!-- Hidden until we have a REAL quote from an early adopter (with permission).
         To restore: re-add MktTestimonialComponent to imports and uncomment.
    <mkt-testimonial
      quote="…real early-adopter quote…"
      author="…their name…"
      role="…site · location…" />
    -->

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
    { label: 'Sign in', route: '/login' },
  ];

  /** The "what you can do / save water" grid — the conservation (money) angle and the
   *  day-to-day capabilities, merged into one deduped set so each idea is said once.
   *  "See it from anywhere" lives in the hero and the live dashboard, so it is not
   *  repeated here. */
  protected readonly capabilities: MktFeatureItem[] = [
    { title: 'Catch leaks early', body: 'Flow sensors spot a line that should be still and warn you the same day, before it drains a tank or floods a field.' },
    { title: 'Use only what you need', body: 'Tanks fill to a set level and stop, so nothing overflows and no crop is over-watered.' },
    { title: 'Know your usage', body: '"Field A used 10,300 litres this week" turns guesswork into numbers you can plan around and cut.' },
    { title: 'Take action from your phone', body: 'Reservoir down to 8%? Switch on the borehole pump from your phone. No need to drive out to the farm.' },
    { title: 'Let the routine run itself', body: 'Water the field at 6 AM on Mondays, or whenever the tank drops below 30%. Set it once and forget it.' },
    { title: 'Pump on sun, not diesel', body: 'Solar-run sites water the land on clean power and cut fuel, cost and carbon.' },
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
