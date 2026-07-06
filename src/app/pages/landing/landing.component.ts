import { Component } from '@angular/core';
import {
  HARDWARE_DEVICES,
  HardwareShowcaseComponent,
} from '../../shared/hardware-showcase/hardware-showcase.component';
import { MARKETING_WHATSAPP_HREF, MARKETING_WHATSAPP_NUMBER } from '../../shared/marketing/marketing-contact';
import { MarketingCtaComponent, type CtaButton } from '../../shared/marketing/marketing-cta.component';
import { MarketingFooterComponent } from '../../shared/marketing/marketing-footer.component';
import type { NavLink } from '../../shared/marketing/marketing-nav.component';
import { MarketingNavComponent } from '../../shared/marketing/marketing-nav.component';
import { LiveDashboardComponent } from '../../shared/marketing/modules/live-dashboard.component';
import {
  MktButtonComponent,
  MktFeatureGridComponent,
  MktHeroComponent,
  MktIconChipComponent,
  MktPlanLevelsComponent,
  MktSectionComponent,
  type MktFeatureItem,
} from '../../shared/marketing/ui';
import { applyPageSeo } from '../../shared/seo';

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

/** A physical place where a buyer can ask about or purchase MajiFlow. */
interface PartnerLocation {
  label: string;
  address: string;
  mapHref: string;
}

/** Sales and fulfilment partner shown on the public homepage. */
interface PurchasePartner {
  name: string;
  category: string;
  summary: string;
  fit: string[];
  website: string;
  phone: string;
  email: string;
  locations: PartnerLocation[];
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
 * use-cases): MajiFlow is positioned as a qualified deployment for operators with
 * meaningful water risk. The controller stays autonomous on link loss.
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
    <app-marketing-nav [links]="navLinks" />

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
        <mkt-button variant="primary" route="/pricing">Request a site assessment</mkt-button>
        <a
          [href]="whatsappHref"
          target="_blank"
          rel="noopener"
          aria-label="WhatsApp us"
          title="WhatsApp us"
          class="mkt-btn mkt-btn-ghost gap-2 whitespace-nowrap text-white/90"
        >
          <svg class="h-5 w-5 text-[#25D366]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.198.296-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347M12.051 21.785h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.889-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.886 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.946L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
          </svg>
          <span>WhatsApp </span>
        </a>
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

    <!-- ===================== PARTNERS / WHERE TO BUY ===================== -->
    <mkt-section id="where-to-buy" [tint]="true" width="wide"
      eyebrow="Where to buy"
      heading="Purchase through our partner network"
      subhead="Start with an estimate here, then talk to a local partner for supply, installation, and farm-fit guidance.">
      <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] items-stretch">
        @for (partner of purchasePartners; track partner.name) {
          <article class="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200 shadow-xl shadow-slate-900/5">
            <div class="grid lg:grid-cols-[minmax(0,1fr)_300px]">
              <div class="p-6 sm:p-8">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="rounded-full bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-800 ring-1 ring-cyan-100">Featured partner</span>
                  <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">{{ partner.category }}</span>
                </div>

                <h3 class="mt-5 text-3xl font-bold tracking-tight text-slate-950">{{ partner.name }}</h3>
                <p class="mt-3 max-w-2xl text-sm sm:text-base leading-relaxed text-slate-600">{{ partner.summary }}</p>

                <div class="mt-6 flex flex-wrap gap-2">
                  <a [href]="partner.website" target="_blank" rel="noopener"
                     class="inline-flex items-center justify-center rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800">
                    Visit site
                  </a>
                  <a [href]="'tel:' + partner.phone.replaceAll(' ', '')"
                     class="inline-flex items-center justify-center rounded-full bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-500/20 transition-colors hover:bg-cyan-300">
                    Call
                  </a>
                  <a [href]="'mailto:' + partner.email"
                     class="inline-flex items-center justify-center rounded-full px-5 py-2.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 transition-colors hover:bg-slate-50">
                    Email
                  </a>
                </div>
              </div>

              <div class="border-t border-slate-200 bg-slate-950 p-6 text-white lg:border-l lg:border-t-0 sm:p-8">
                <p class="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Best for</p>
                <div class="mt-4 space-y-3">
                  @for (item of partner.fit; track item) {
                    <div class="flex gap-3 text-sm leading-relaxed text-white/75">
                      <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300"></span>
                      <span>{{ item }}</span>
                    </div>
                  }
                </div>

                <div class="mt-6 border-t border-white/10 pt-5 text-sm">
                  <p class="font-semibold text-white">Order enquiries</p>
                  <a [href]="'tel:' + partner.phone.replaceAll(' ', '')" class="mt-2 block text-white/70 hover:text-cyan-200">{{ partner.phone }}</a>
                  <a [href]="'mailto:' + partner.email" class="mt-1 block text-white/70 hover:text-cyan-200">{{ partner.email }}</a>
                </div>
              </div>
            </div>

            <div class="border-t border-slate-200 bg-white px-6 py-5 sm:px-8">
              <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Purchase and pickup locations</p>
              <div class="mt-4 grid gap-4 md:grid-cols-3">
                @for (location of partner.locations; track location.label) {
                  <a [href]="location.mapHref" target="_blank" rel="noopener"
                     class="group block rounded-lg border border-slate-200 bg-slate-50 p-4 transition-colors hover:border-cyan-200 hover:bg-cyan-50">
                    <span class="block text-sm font-semibold text-slate-950">{{ location.label }}</span>
                    <span class="mt-1 block text-sm leading-relaxed text-slate-600 group-hover:text-slate-800">{{ location.address }}</span>
                    <span class="mt-3 inline-flex text-xs font-semibold text-cyan-700">Open map</span>
                  </a>
                }
              </div>
            </div>
          </article>
        }

        <aside class="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-7">
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">Partner list</p>
            <div class="mt-4 space-y-3">
              @for (partner of purchasePartners; track partner.name) {
                <a [href]="partner.website" target="_blank" rel="noopener"
                   class="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900 transition-colors hover:border-cyan-200 hover:bg-cyan-50">
                  <span>{{ partner.name }}</span>
                  <span class="text-cyan-700">Visit</span>
                </a>
              }
            </div>

            <div class="mt-7 border-t border-slate-200 pt-6">
              <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Partner with us</p>
              <h3 class="mt-3 text-xl font-bold tracking-tight text-slate-950">Want MajiFlow in your catalogue?</h3>
              <p class="mt-3 text-sm leading-relaxed text-slate-600">
                We are expanding slowly with irrigation, agrovet, plumbing, and solar partners who already support farms and water sites.
              </p>
              <a [href]="whatsappHref" target="_blank" rel="noopener"
                 class="mt-4 block text-sm font-semibold text-cyan-700 hover:text-cyan-600">
                WhatsApp 
              </a>
            </div>
          </div>
          <div class="mt-6">
            <a href="mailto:info@majiflow.com"
               class="inline-flex w-full items-center justify-center rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800">
              Become a partner
            </a>
          </div>
        </aside>
      </div>
    </mkt-section>

    <!-- ===================== DEPLOYMENT FIT ===================== -->
    <mkt-section [tint]="true"
      heading="For serious water operations"
      subhead="MajiFlow is not the cheapest controller box. It is for sites where water failure is expensive: guests without water, crops missing irrigation, pumps burning out, or litres sold without proof. We assess fit before we quote.">
      <mkt-plan-levels [compact]="true" />
      <div class="mt-8 text-center">
        <mkt-button variant="primary" route="/pricing">Check deployment fit</mkt-button>
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
          <p class="mt-1.5 text-sm text-white/60 leading-relaxed">Add battery and solar and your site runs right through a power cut, without tying every outage to diesel logistics.</p>
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

  protected readonly navLinks: NavLink[] = [
    { label: 'How it works', route: '/how-it-works' },
    { label: 'Features', route: '/features' },
    { label: 'Assessment', route: '/pricing' },
  ];

  protected readonly ctaButtons: CtaButton[] = [
    { label: 'Request assessment', route: '/pricing' },
    { label: 'WhatsApp us', href: MARKETING_WHATSAPP_HREF },
  ];

  protected readonly whatsappHref = MARKETING_WHATSAPP_HREF;
  protected readonly whatsappNumber = MARKETING_WHATSAPP_NUMBER;

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
    { title: 'Know before the tank runs dry', body: 'A low tank warns you in advance, so apartments, hotels and any site that runs on water are never caught off guard. You hear about it first, not your tenants or guests.' },
  ];

  protected readonly verticals: Vertical[] = [
    { title: 'Farms', body: 'Automatic irrigation and remote pump control, so every drop reaches the crop, on small plots and large commercial farms alike.' },
    { title: 'Hotels, lodges and apartments', body: 'Steady pressure and balanced tanks for guests and tenants, with a warning before a tank runs low, so no block or room is left without water.' },
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

  protected readonly purchasePartners: PurchasePartner[] = [
    {
      name: 'Plum',
      category: 'Irrigation, agrovet and pharmacy partner',
      summary:
        'Plum supports Kenyan farms with smart irrigation systems, drip kits, solar pumps, farm inputs, and professional design and installation guidance.',
      fit: [
        'Irrigation system supply',
        'Farm design and installation support',
        'Online or branch purchase enquiries',
      ],
      website: 'https://plum.co.ke/',
      phone: '+254 721 424 444',
      email: 'info@plum.co.ke',
      locations: [
        {
          label: 'Nairobi branch',
          address: 'Alpha Centre, Cabanas, Along Mombasa Road, Nairobi',
          mapHref: 'https://www.google.com/maps/search/?api=1&query=Alpha%20Centre%20Cabanas%20Mombasa%20Road%20Nairobi',
        },
        {
          label: 'Matuu head office',
          address: 'A1 Plaza, Ground Floor, next to Faulu Bank, Matuu',
          mapHref: 'https://www.google.com/maps/search/?api=1&query=A1%20Plaza%20Matuu%20Faulu%20Bank',
        },
        {
          label: 'Matuu branch',
          address: 'MB Centre, Ground Floor, next to Co-op Bank, Along Thika-Garissa Highway, Matuu',
          mapHref: 'https://www.google.com/maps/search/?api=1&query=MB%20Centre%20Matuu%20Co-op%20Bank%20Thika%20Garissa%20Highway',
        },
      ],
    },
  ];
}
