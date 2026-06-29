import { Component, computed, inject, signal, type WritableSignal } from '@angular/core';
import type { SiteTopology, EasyModeProfile } from '@core';
import { BackendService } from '../../core/services/backend.service';
import { PRICING, KIT_TIERS, ADDON_SERVICES, estimate, kes, type EstimateInput, type Segment } from './pricing.model';
import { applyPageSeo } from '../../shared/seo';
import { MarketingNavComponent } from '../../shared/marketing/marketing-nav.component';
import { MarketingFooterComponent } from '../../shared/marketing/marketing-footer.component';
import { MktHeroComponent, MktPlanLevelsComponent } from '../../shared/marketing/ui';
import { SystemEstimatorComponent, type SizedEstimate } from './system-estimator.component';

type SubmitState = 'idle' | 'sending' | 'done' | 'error';
type Kit = 'lite' | 'pro' | 'enterprise';

/**
 * Public pricing page (route `/pricing`). Renders full-bleed with its own nav/footer.
 *
 * Flow: three one-time kit tiers (Lite / Pro / Enterprise) carry the headline pricing;
 * the flat monthly per site is a quiet constant. Add-on services (water quality, billing,
 * ...) are available on ANY kit. Below the cards, a kit SELECTOR drives three different
 * funnels in a "describe your site" tool:
 *   - Lite (DIY): size a simple site; a fit-guard nudges to Pro if it needs more than one
 *     controller. CTA captures a self-install lead.
 *   - Pro (done-for-you): CONTACT ONLY. We design and install; the CTA requests a call.
 *   - Enterprise (custom): contact sales; the per-component sizer is hidden.
 * Everything lands as a consent-gated lead carrying { kit, intent, addons } plus the
 * composed topology/profile for conversion. A honeypot + server hook drop bot spam.
 */
@Component({
  selector: 'app-pricing',
  standalone: true,
  imports: [MarketingNavComponent, MarketingFooterComponent, MktHeroComponent, MktPlanLevelsComponent, SystemEstimatorComponent],
  host: { class: 'flex-1 overflow-y-auto bg-white text-slate-900' },
  template: `
    <!-- NAV -->
    <app-marketing-nav />

    <!-- HERO -->
    <mkt-hero size="md">
      <h1 class="mkt-h1 text-3xl sm:text-5xl">What will it cost?</h1>
      <p class="mt-4 text-white/70 max-w-2xl mx-auto text-sm sm:text-lg leading-relaxed">
        No mystery pricing. Pick a kit you buy once: Lite, Pro or Enterprise. Each runs on the
        same flat monthly per site, finalized with your quote.
      </p>
      <p class="mt-3 text-xs text-cyan-200/80">Not sure which kit? Describe your site below and we'll point you to the right one.</p>
    </mkt-hero>

    <!-- KIT TIERS + ADD-ON SERVICES -->
    <section class="mkt-section-tight">
      <div class="max-w-5xl mx-auto">
        <div class="text-center max-w-2xl mx-auto">
          <h2 class="text-2xl font-bold tracking-tight">Choose your kit</h2>
          <p class="mt-3 text-sm text-slate-600 leading-relaxed">
            One-time kits for every stage: self-install Lite, done-for-you Pro, or custom
            Enterprise. Each runs on the same flat monthly per site.
          </p>
        </div>
        <div class="mt-8">
          <mkt-plan-levels />
        </div>

        <!-- Add-on services: available on any kit -->
        <div class="mt-12">
          <div class="text-center max-w-2xl mx-auto">
            <h3 class="text-lg font-bold tracking-tight">Add-on services, on any kit</h3>
            <p class="mt-1.5 text-sm text-slate-600 leading-relaxed">
              Add these to Lite, Pro or Enterprise. Priced separately from the kit and the monthly.
            </p>
          </div>
          <div class="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            @for (a of addons; track a.key) {
              <div class="rounded-2xl bg-slate-50 ring-1 ring-slate-200 p-5">
                <h4 class="font-semibold text-slate-900">{{ a.name }}</h4>
                <p class="mt-1 text-sm text-slate-600 leading-relaxed">{{ a.blurb }}</p>
                <p class="mt-2 text-xs font-semibold text-cyan-700">{{ a.availability }}</p>
              </div>
            }
          </div>
        </div>
      </div>
    </section>

    <!-- GET STARTED: kit selector drives three funnels -->
    <section class="mkt-section-tight">
      <div class="max-w-5xl mx-auto">
        <div class="text-center max-w-2xl mx-auto">
          <h2 class="text-2xl font-bold tracking-tight">Get started</h2>
          <p class="mt-3 text-sm text-slate-600 leading-relaxed">Pick how you'd like to go, and we'll take it from there.</p>
        </div>

        <!-- Kit selector -->
        <div class="mt-6 grid gap-3 sm:grid-cols-3 max-w-3xl mx-auto">
          @for (k of kits; track k.key) {
            <button type="button" (click)="kit.set(k.key)" [class]="kitBtnCls(k.key)">
              <span class="block text-sm font-bold">{{ k.name }}</span>
              <span class="block text-xs" [class]="kit() === k.key ? 'text-white/80' : 'text-slate-500'">{{ k.sub }}</span>
            </button>
          }
        </div>

        <div class="mt-8 grid gap-8 lg:grid-cols-5">

          <!-- Left: describe-your-site (Lite/Pro) or Enterprise prompt, plus add-on picker -->
          <div class="lg:col-span-3 space-y-5">
            @if (kit() === 'enterprise') {
              <div class="rounded-2xl bg-slate-50 ring-1 ring-slate-200 p-6">
                <h3 class="font-semibold text-slate-900">Tell us about your operation</h3>
                <p class="mt-1 text-sm text-slate-600 leading-relaxed">
                  Enterprise is tailored to you: multiple sites, water-quality monitoring, an uptime
                  SLA and priority support. Share a few details below and we'll scope and price it with you.
                </p>
              </div>
            } @else {
              <!-- Plain-language sizer: fills the numbers below from a site description. -->
              <app-system-estimator (sized)="applySizing($event)" />

              <!-- Optional fine-tuning, collapsed to keep the page calm. -->
              <details class="group">
                <summary class="cursor-pointer select-none py-2 text-sm font-semibold text-slate-700 hover:text-slate-900">
                  Adjust the details <span class="font-normal text-slate-400">: pumps, sizes, special cases (optional)</span>
                </summary>
                <div class="mt-4 space-y-5">

                  <div class="rounded-2xl bg-slate-50 ring-1 ring-slate-200 p-5">
                    <h3 class="font-semibold text-slate-900">What is this site for?</h3>
                    <p class="mt-1 text-sm text-slate-600 leading-relaxed">Sets up the right dashboard and the add-on that fits. It never limits what you can buy.</p>
                    <div class="mt-3 grid gap-2 sm:grid-cols-3">
                      @for (s of segments; track s.key) {
                        <button type="button" (click)="segment.set(s.key)"
                                class="text-left rounded-xl px-3 py-2.5 ring-1 transition-colors"
                                [class]="segment() === s.key ? 'bg-cyan-500 text-white ring-cyan-500' : 'bg-white text-slate-700 ring-slate-300 hover:ring-cyan-400'">
                          <span class="block text-sm font-semibold">{{ s.label }}</span>
                          <span class="block text-xs" [class]="segment() === s.key ? 'text-white/80' : 'text-slate-500'">{{ s.blurb }}</span>
                        </button>
                      }
                    </div>
                  </div>

                  @for (q of questions; track q.key) {
                    <div class="rounded-2xl bg-slate-50 ring-1 ring-slate-200 p-5">
                      <div class="flex items-start justify-between gap-4">
                        <div>
                          <h3 class="font-semibold text-slate-900">{{ q.title }}</h3>
                          <p class="mt-1 text-sm text-slate-600 leading-relaxed">{{ q.help }}</p>
                        </div>
                        <div class="flex items-center gap-2 shrink-0">
                          <button type="button" (click)="step(q.sig, -1)" aria-label="decrease"
                                  class="w-9 h-9 rounded-full ring-1 ring-slate-300 text-slate-700 text-lg font-bold hover:bg-white disabled:opacity-40"
                                  [disabled]="q.sig() <= 0">−</button>
                          <input type="number" inputmode="numeric" min="0" max="99" [value]="q.sig()"
                                 (input)="setNum(q.sig, $event)"
                                 class="w-14 text-center rounded-lg ring-1 ring-slate-300 py-1.5 font-semibold tabular-nums" />
                          <button type="button" (click)="step(q.sig, 1)" aria-label="increase"
                                  class="w-9 h-9 rounded-full ring-1 ring-slate-300 text-slate-700 text-lg font-bold hover:bg-white">+</button>
                        </div>
                      </div>
                    </div>
                  }

                  <label class="flex items-start gap-3 rounded-2xl bg-slate-50 ring-1 ring-slate-200 p-5 cursor-pointer">
                    <input type="checkbox" [checked]="spread()" (change)="spread.set(isChecked($event))" class="mt-1 w-4 h-4 accent-cyan-500" />
                    <span>
                      <span class="font-semibold text-slate-900">Is your gear spread out, more than ~100m apart?</span>
                      <span class="block mt-1 text-sm text-slate-600 leading-relaxed">
                        Close together, one controller runs the lot and extra tanks ride a metering hub. Spread
                        out, we drop in another controller near the far cluster instead of running a long wire.
                      </span>
                    </span>
                  </label>

                  <label class="flex items-start gap-3 rounded-2xl bg-slate-50 ring-1 ring-slate-200 p-5 cursor-pointer">
                    <input type="checkbox" [checked]="largeSize()" (change)="largeSize.set(isChecked($event))" class="mt-1 w-4 h-4 accent-cyan-500" />
                    <span>
                      <span class="font-semibold text-slate-900">Any pipe bigger than 3/4 inch (20 mm)?</span>
                      <span class="block mt-1 text-sm text-slate-600 leading-relaxed">
                        Larger valves and meters are priced per quote. We confirm those and credit the
                        standard part, so the figure here covers standard sizes only.
                      </span>
                    </span>
                  </label>

                  <label class="flex items-start gap-3 rounded-2xl bg-slate-50 ring-1 ring-slate-200 p-5 cursor-pointer">
                    <input type="checkbox" [checked]="threePhase()" (change)="threePhase.set(isChecked($event))" class="mt-1 w-4 h-4 accent-cyan-500" />
                    <span>
                      <span class="font-semibold text-slate-900">Are your pumps 3-phase?</span>
                      <span class="block mt-1 text-sm text-slate-600 leading-relaxed">
                        3-phase pumps run through their own inverter over a data link, so they add no relay
                        cost and handle any size. We don't yet support every inverter brand, so we confirm yours.
                      </span>
                    </span>
                  </label>

                  @if (!threePhase()) {
                    <label class="flex items-start gap-3 rounded-2xl bg-slate-50 ring-1 ring-slate-200 p-5 cursor-pointer">
                      <input type="checkbox" [checked]="bigPump()" (change)="bigPump.set(isChecked($event))" class="mt-1 w-4 h-4 accent-cyan-500" />
                      <span>
                        <span class="font-semibold text-slate-900">Any pump bigger than 2 hp?</span>
                        <span class="block mt-1 text-sm text-slate-600 leading-relaxed">
                          The standard 30A relay switches a single-phase pump up to about 2 hp (1.5 kW). A
                          bigger motor needs a contactor, which we add and price per quote.
                        </span>
                      </span>
                    </label>
                  }
                </div>
              </details>
            }

            <!-- Add-on services: selectable on ANY kit -->
            <div class="rounded-2xl bg-slate-50 ring-1 ring-slate-200 p-5">
              <h3 class="font-semibold text-slate-900">Add-on services <span class="font-normal text-slate-400">(optional)</span></h3>
              <p class="mt-1 text-sm text-slate-600 leading-relaxed">Available on any kit. Tick any you're interested in and we'll include them in your quote.</p>
              <div class="mt-3 grid gap-2 sm:grid-cols-2">
                @for (a of addons; track a.key) {
                  <label class="flex items-start gap-2.5 rounded-xl bg-white ring-1 ring-slate-200 p-3 cursor-pointer hover:ring-cyan-400 transition-colors">
                    <input type="checkbox" [checked]="addonSelected(a.key)" (change)="toggleAddon(a.key, $event)" class="mt-0.5 w-4 h-4 accent-cyan-500" />
                    <span>
                      <span class="block text-sm font-medium text-slate-800">{{ a.name }}</span>
                      <span class="block text-xs text-slate-500">{{ a.availability }}</span>
                    </span>
                  </label>
                }
              </div>
            </div>
          </div>

          <!-- Right: result card, by selected kit -->
          <div class="lg:col-span-2">
            <div class="lg:sticky lg:top-24 rounded-2xl bg-slate-950 text-white p-5 sm:p-6 shadow-xl">
              @switch (kit()) {

                @case ('lite') {
                  <p class="text-xs font-semibold uppercase tracking-wider text-cyan-300">Lite · DIY</p>
                  @if (liteFits()) {
                    <p class="mt-2 text-3xl font-bold tracking-tight">{{ kitPriceLabel('lite') }}<span class="text-lg font-medium text-white/50"> one-time</span></p>
                    <p class="mt-1 text-sm text-white/65 leading-relaxed">You install it yourself, with an easy step-by-step manual included.</p>
                    @if (quoteTopology()) {
                      <div class="mt-4 border-t border-white/10 pt-4">
                        <p class="text-sm text-white/70">The system you described: {{ est().summary }}</p>
                        <ul class="mt-3 space-y-1.5 text-xs text-white/50">
                          @for (l of est().lines; track l.label) {
                            <li class="flex justify-between gap-3">
                              <span>{{ l.label }}</span>
                              @if (l.qty > 1) { <span class="text-white/35 tabular-nums shrink-0">× {{ l.qty }}</span> }
                            </li>
                          }
                        </ul>
                      </div>
                    }
                    <p class="mt-4 text-xs text-white/45 leading-relaxed">
                      Plus a flat monthly per site, finalized with your quote. On-site it keeps working without a subscription.
                    </p>
                    <button type="button" (click)="scrollToContact()" class="mt-5 w-full rounded-full px-4 py-3 text-sm font-semibold bg-cyan-400 text-slate-950 hover:bg-cyan-300 transition-colors">
                      Get the Lite kit
                    </button>
                  } @else {
                    <p class="mt-2 text-2xl font-bold tracking-tight">This is bigger than Lite</p>
                    <p class="mt-2 text-sm text-white/70 leading-relaxed">
                      Your site needs more than one controller, so it isn't a simple self-install kit. Pro designs and installs it for you, end to end.
                    </p>
                    <button type="button" (click)="kit.set('pro')" class="mt-5 w-full rounded-full px-4 py-3 text-sm font-semibold bg-cyan-400 text-slate-950 hover:bg-cyan-300 transition-colors">
                      Switch to Pro
                    </button>
                  }
                }

                @case ('pro') {
                  <p class="text-xs font-semibold uppercase tracking-wider text-cyan-300">Pro · done for you</p>
                  <p class="mt-2 text-3xl font-bold tracking-tight">{{ kitPriceLabel('pro') }}<span class="text-lg font-medium text-white/50"> one-time</span></p>
                  <p class="mt-1 text-sm text-white/65 leading-relaxed">We design and install it for you, with 3 assisted revisions in your first month and full warranty.</p>
                  @if (quoteTopology()) {
                    <div class="mt-4 border-t border-white/10 pt-4">
                      <p class="text-sm text-white/70">The system we'd build: {{ est().summary }}</p>
                      <ul class="mt-3 space-y-1.5 text-xs text-white/50">
                        @for (l of est().lines; track l.label) {
                          <li class="flex justify-between gap-3">
                            <span>{{ l.label }}</span>
                            @if (l.qty > 1) { <span class="text-white/35 tabular-nums shrink-0">× {{ l.qty }}</span> }
                          </li>
                        }
                      </ul>
                    </div>
                  }
                  <p class="mt-4 text-xs text-white/45 leading-relaxed">
                    Plus a flat monthly per site, finalized with your quote. We confirm the design, hardware and price with you before anything is built.
                  </p>
                  <button type="button" (click)="scrollToContact()" class="mt-5 w-full rounded-full px-4 py-3 text-sm font-semibold bg-cyan-400 text-slate-950 hover:bg-cyan-300 transition-colors">
                    Request a call
                  </button>
                }

                @case ('enterprise') {
                  <p class="text-xs font-semibold uppercase tracking-wider text-cyan-300">Enterprise · custom</p>
                  <p class="mt-2 text-2xl font-bold tracking-tight">Tailored to your operation</p>
                  <p class="mt-2 text-sm text-white/70 leading-relaxed">
                    Multiple sites on one dashboard, water-quality monitoring, an uptime SLA and priority
                    support. We scope and price it with you.
                  </p>
                  @if (selectedAddons().length) {
                    <p class="mt-4 text-xs text-white/55">Add-ons you flagged: {{ selectedAddonNames() }}.</p>
                  }
                  <button type="button" (click)="scrollToContact()" class="mt-5 w-full rounded-full px-4 py-3 text-sm font-semibold bg-cyan-400 text-slate-950 hover:bg-cyan-300 transition-colors">
                    Talk to us
                  </button>
                }
              }

              <p class="mt-4 text-[11px] text-white/40 leading-relaxed">
                An estimate, not a final quote. The real figures depend on a site survey, pipe sizes and install. Prices in KES.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- LEAD CAPTURE: single form, adapts to the selected kit -->
    <section id="quote-lead" class="px-5 sm:px-8 pb-20">
      <div class="max-w-2xl mx-auto rounded-2xl ring-1 ring-slate-200 bg-slate-50 p-7">
        @if (submitState() === 'done') {
          <div class="text-center py-6">
            <div class="w-12 h-12 mx-auto rounded-full bg-cyan-100 text-cyan-700 flex items-center justify-center mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <h2 class="text-xl font-bold">Got it. Thank you.</h2>
            <p class="mt-2 text-sm text-slate-600">We'll be in touch shortly. Your details are still on this page if you want to tweak anything.</p>
          </div>
        } @else {
          <h2 class="text-xl font-bold tracking-tight">{{ leadHeading() }}</h2>
          <p class="mt-1.5 text-sm text-slate-600 leading-relaxed">
            Leave your details and we'll follow up. We only use them to contact you about this, and we won't share them.
          </p>

          <div class="mt-5 grid gap-4 sm:grid-cols-2">
            <label class="block sm:col-span-2">
              <span class="text-sm font-medium text-slate-700">Name</span>
              <input type="text" [value]="name()" (input)="name.set(inputValue($event))"
                     class="mt-1 w-full rounded-lg ring-1 ring-slate-300 px-3 py-2 focus:ring-2 focus:ring-cyan-500 outline-none" />
            </label>
            <label class="block">
              <span class="text-sm font-medium text-slate-700">Phone</span>
              <input type="tel" [value]="phone()" (input)="phone.set(inputValue($event))"
                     class="mt-1 w-full rounded-lg ring-1 ring-slate-300 px-3 py-2 focus:ring-2 focus:ring-cyan-500 outline-none" />
            </label>
            <label class="block">
              <span class="text-sm font-medium text-slate-700">Email</span>
              <input type="email" [value]="email()" (input)="email.set(inputValue($event))"
                     class="mt-1 w-full rounded-lg ring-1 ring-slate-300 px-3 py-2 focus:ring-2 focus:ring-cyan-500 outline-none" />
            </label>
            <label class="block sm:col-span-2">
              <span class="text-sm font-medium text-slate-700">Anything else we should know? <span class="font-normal text-slate-400">(optional)</span></span>
              <textarea rows="2" [value]="note()" (input)="note.set(inputValue($event))"
                        class="mt-1 w-full rounded-lg ring-1 ring-slate-300 px-3 py-2 focus:ring-2 focus:ring-cyan-500 outline-none resize-none"></textarea>
            </label>

            <!-- Honeypot: hidden from people, tempting to bots. Must stay empty. -->
            <input type="text" tabindex="-1" autocomplete="off" aria-hidden="true"
                   [value]="hp()" (input)="hp.set(inputValue($event))" class="hidden" />
          </div>

          <label class="mt-4 flex items-start gap-3 cursor-pointer">
            <input type="checkbox" [checked]="consent()" (change)="consent.set(isChecked($event))"
                   class="mt-0.5 w-4 h-4 accent-cyan-500" />
            <span class="text-sm text-slate-700">I agree to be contacted about this.</span>
          </label>

          <p class="mt-2 text-xs text-slate-500">Give us a phone or email so we can reach you.</p>

          @if (submitState() === 'error') {
            <p class="mt-3 text-sm text-rose-600">{{ errorMsg() }}</p>
          }

          <button type="button" (click)="submit()" [disabled]="!canSubmit() || submitState() === 'sending'"
                  class="mt-5 w-full rounded-full px-5 py-3 text-sm font-semibold bg-cyan-500 text-white hover:bg-cyan-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {{ submitState() === 'sending' ? 'Sending…' : leadCta() }}
          </button>
        }
      </div>
    </section>

    <!-- FOOTER -->
    <app-marketing-footer tagline="Honest pricing. No surprises." />
  `,
})
export class PricingComponent {
  private readonly backend = inject(BackendService);
  protected readonly caps = PRICING.caps;
  protected readonly addons = ADDON_SERVICES;

  constructor() {
    applyPageSeo({
      title: 'Pricing | MajiFlow water monitoring and control',
      description:
        'Three one-time kits (Lite self-install, Pro done-for-you, Enterprise custom), each on a flat monthly per site, plus add-on services on any kit. Describe your site for the right fit.',
      path: 'pricing',
    });
  }

  // --- Kit selector ---
  protected readonly kit = signal<Kit>('pro');
  protected readonly kits = [
    { key: 'lite' as Kit, name: 'Lite', sub: 'DIY, self-install' },
    { key: 'pro' as Kit, name: 'Pro', sub: 'Done for you' },
    { key: 'enterprise' as Kit, name: 'Enterprise', sub: 'Custom' },
  ] as const;

  protected kitBtnCls(key: Kit): string {
    const on = this.kit() === key;
    return `text-center rounded-xl px-4 py-3 ring-1 transition-colors ${on ? 'bg-cyan-500 text-white ring-cyan-500' : 'bg-white text-slate-700 ring-slate-300 hover:ring-cyan-400'}`;
  }

  /** One-time kit price label from KIT_TIERS (single source of truth), or "Custom". */
  protected kitPriceLabel(key: Kit): string {
    const t = KIT_TIERS.find((k) => k.name.toLowerCase() === key);
    return t && t.price !== null ? kes(t.price) : 'Custom';
  }

  /** The lead intent implied by the selected kit. */
  protected kitIntent(): string {
    return this.kit() === 'lite' ? 'self-install' : this.kit() === 'pro' ? 'done-for-you' : 'sales';
  }

  // --- Add-on services (any kit) ---
  protected readonly selectedAddons = signal<string[]>([]);
  protected addonSelected(key: string): boolean {
    return this.selectedAddons().includes(key);
  }
  protected toggleAddon(key: string, e: Event): void {
    const on = this.isChecked(e);
    this.selectedAddons.update((list) => (on ? Array.from(new Set([...list, key])) : list.filter((k) => k !== key)));
  }
  protected selectedAddonNames(): string {
    const keys = this.selectedAddons();
    return ADDON_SERVICES.filter((a) => keys.includes(a.key)).map((a) => a.name).join(', ');
  }

  // --- Estimator inputs ---
  protected readonly segment = signal<Segment>('farm');
  protected readonly pumps = signal(1);
  protected readonly valves = signal(1);
  protected readonly flow = signal(1);
  protected readonly tanks = signal(1);
  protected readonly spread = signal(false);
  protected readonly largeSize = signal(false);
  protected readonly bigPump = signal(false);
  protected readonly threePhase = signal(false);

  // Framing question: picks the dashboard and the pitched add-on, never gates a purchase.
  protected readonly segments = [
    { key: 'farm' as Segment, label: 'Farm', blurb: 'Grow more with less' },
    { key: 'property' as Segment, label: 'Property or estate', blurb: 'Bill tenants, protect supply' },
    { key: 'water_supply' as Segment, label: 'Water supply', blurb: 'Meter and sell water' },
  ] as const;

  protected readonly questions = [
    { key: 'pumps', title: 'Pumps to switch', help: 'Pumps the system turns on and off. Most sites have one.', sig: this.pumps },
    { key: 'valves', title: 'Water lines to control', help: 'Valves that open and close on their own, like zones, outlets and fill lines.', sig: this.valves },
    { key: 'flow', title: 'Points to measure flow', help: 'Where you want to see how much water is moving.', sig: this.flow },
    { key: 'tanks', title: 'Tanks to monitor', help: 'Tanks whose level you want to watch. No hard limit; extra tanks ride a metering hub.', sig: this.tanks },
  ] as const;

  protected readonly est = computed(() =>
    estimate({ pumps: this.pumps(), valves: this.valves(), flow: this.flow(), tanks: this.tanks(), segment: this.segment(), spread: this.spread(), largeSize: this.largeSize(), bigPump: this.bigPump(), threePhase: this.threePhase() } satisfies EstimateInput),
  );

  /** Lite covers a single, composable controller. A multi-controller or over-Easy-Mode
   *  site does not fit Lite, so the Lite card nudges the visitor to Pro instead. */
  protected readonly liteFits = computed(() => !this.est().multiController && !this.designHandoff());

  // --- Lead form ---
  protected readonly name = signal('');
  protected readonly phone = signal('');
  protected readonly email = signal('');
  protected readonly note = signal('');
  protected readonly consent = signal(false);
  protected readonly hp = signal(''); // honeypot
  protected readonly submitState = signal<SubmitState>('idle');
  protected readonly errorMsg = signal('');

  protected readonly canSubmit = computed(
    () => this.name().trim() !== '' && this.consent() && (this.phone().trim() !== '' || this.email().trim() !== ''),
  );

  protected leadHeading(): string {
    switch (this.kit()) {
      case 'lite': return 'Get your Lite kit';
      case 'pro': return 'Request a call about Pro';
      default: return 'Talk to us about Enterprise';
    }
  }
  protected leadCta(): string {
    switch (this.kit()) {
      case 'lite': return 'Send my request';
      case 'pro': return 'Request a call';
      default: return 'Contact sales';
    }
  }

  // --- Composed design, kept for lead conversion ---
  protected readonly quoteTopology = signal<SiteTopology | null>(null);
  protected readonly quoteProfile = signal<EasyModeProfile | null>(null);
  /** Set when the described site exceeds Easy Mode (drives the Lite fit-guard). */
  protected readonly designHandoff = signal<{ reason: string; message: string } | null>(null);

  /** Fill the estimator inputs from the plain-language sizer, and keep the composed design
   *  so a captured lead can be converted into a wired site later (re-composed with a board). */
  protected applySizing(e: SizedEstimate): void {
    this.quoteTopology.set(e.topology);
    this.quoteProfile.set(e.profile);
    this.designHandoff.set(e.handoff);
    if (!e.topology) return;
    this.segment.set(e.segment);
    this.pumps.set(e.pumps);
    this.valves.set(e.valves);
    this.flow.set(e.flow);
    this.tanks.set(e.tanks);
  }

  /** Scroll to the single lead form. */
  protected scrollToContact(): void {
    document.getElementById('quote-lead')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  protected step(sig: WritableSignal<number>, delta: number): void {
    sig.set(Math.min(99, Math.max(0, sig() + delta)));
  }

  protected setNum(sig: WritableSignal<number>, e: Event): void {
    const v = parseInt(this.inputValue(e), 10);
    sig.set(Number.isFinite(v) ? Math.min(99, Math.max(0, v)) : 0);
  }

  protected inputValue(e: Event): string {
    const t = e.target;
    return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement ? t.value : '';
  }

  protected isChecked(e: Event): boolean {
    const t = e.target;
    return t instanceof HTMLInputElement ? t.checked : false;
  }

  protected async submit(): Promise<void> {
    if (!this.canSubmit() || this.submitState() === 'sending') return;
    this.submitState.set('sending');
    try {
      await this.backend.leadCreate({
        name: this.name().trim(),
        phone: this.phone().trim(),
        email: this.email().trim(),
        consent: this.consent(),
        // The kit chosen, the funnel intent, the add-ons of interest, and the composed
        // design + answers (when sized) so follow-up opens the exact system and an admin
        // can convert it into a wired site.
        estimate: {
          ...this.est(),
          kit: this.kit(),
          intent: this.kitIntent(),
          addons: this.selectedAddons(),
          topology: this.quoteTopology(),
          profile: this.quoteProfile(),
          designRequest: !!this.designHandoff(),
          designReason: this.designHandoff()?.reason,
          note: this.note().trim() || undefined,
        },
        hp: this.hp(),
      });
      this.submitState.set('done');
    } catch {
      this.errorMsg.set('Could not send right now. Please try again, or reach us directly.');
      this.submitState.set('error');
    }
  }
}
