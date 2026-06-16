import { Component, computed, inject, signal, type WritableSignal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BackendService } from '../../core/services/backend.service';
import { PRICING, SEGMENT_PACKS, estimate, kes, type EstimateInput, type Segment } from './pricing.model';
import { applyPageSeo } from '../../shared/seo';
import { MarketingNavComponent } from '../../shared/marketing/marketing-nav.component';
import { MarketingFooterComponent } from '../../shared/marketing/marketing-footer.component';

type SubmitState = 'idle' | 'sending' | 'done' | 'error';

/**
 * Public pricing estimator (route `/pricing`). Renders full-bleed with its own
 * nav/footer (the app shell hides chrome here, like the landing page).
 *
 * Transparency-first: the estimate is computed and shown live from three plain
 * questions — no form gates the number. Lead capture sits *below* the visible
 * estimate and is consent-gated; the estimate snapshot rides along so followup
 * has context. A honeypot field plus a server-side hook drop bot spam.
 */
@Component({
  selector: 'app-pricing',
  standalone: true,
  imports: [RouterLink, MarketingNavComponent, MarketingFooterComponent],
  host: { class: 'flex-1 overflow-y-auto bg-white text-slate-900' },
  template: `
    <!-- NAV -->
    <app-marketing-nav />

    <!-- HERO -->
    <header class="bg-slate-950 text-white px-5 sm:px-8 pt-14 pb-12 text-center">
      <h1 class="text-3xl sm:text-5xl font-bold tracking-tight">What will it cost?</h1>
      <p class="mt-4 text-white/70 max-w-2xl mx-auto text-sm sm:text-lg leading-relaxed">
        No mystery pricing. Answer three questions and see your monthly plan straight away,
        plus the one-time kit that runs it.
      </p>
      <p class="mt-3 text-xs text-cyan-200/80">Your monthly plan, plus a one-time hardware kit and installation priced to your site.</p>
    </header>

    <!-- ESTIMATOR -->
    <section class="px-5 sm:px-8 py-12 sm:py-16">
      <div class="max-w-5xl mx-auto grid gap-8 lg:grid-cols-5">

        <!-- Questions -->
        <div class="lg:col-span-3 space-y-5">
          <h2 class="text-xl font-bold tracking-tight">Tell us about your site</h2>

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
            <input type="checkbox" [checked]="spread()" (change)="spread.set(isChecked($event))"
                   class="mt-1 w-4 h-4 accent-cyan-500" />
            <span>
              <span class="font-semibold text-slate-900">Is your gear spread out, more than ~100m apart?</span>
              <span class="block mt-1 text-sm text-slate-600 leading-relaxed">
                Close together, one controller runs the lot and extra tanks ride a metering hub. Spread
                out, we drop in another controller near the far cluster instead of running a long wire.
              </span>
            </span>
          </label>

          <label class="flex items-start gap-3 rounded-2xl bg-slate-50 ring-1 ring-slate-200 p-5 cursor-pointer">
            <input type="checkbox" [checked]="largeSize()" (change)="largeSize.set(isChecked($event))"
                   class="mt-1 w-4 h-4 accent-cyan-500" />
            <span>
              <span class="font-semibold text-slate-900">Any pipe bigger than 3/4 inch (20 mm)?</span>
              <span class="block mt-1 text-sm text-slate-600 leading-relaxed">
                Larger valves and meters are priced per quote. We confirm those and credit the
                standard part, so the figure here covers standard sizes only.
              </span>
            </span>
          </label>

          <label class="flex items-start gap-3 rounded-2xl bg-slate-50 ring-1 ring-slate-200 p-5 cursor-pointer">
            <input type="checkbox" [checked]="threePhase()" (change)="threePhase.set(isChecked($event))"
                   class="mt-1 w-4 h-4 accent-cyan-500" />
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
              <input type="checkbox" [checked]="bigPump()" (change)="bigPump.set(isChecked($event))"
                     class="mt-1 w-4 h-4 accent-cyan-500" />
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

        <!-- Live estimate -->
        <div class="lg:col-span-2">
          <div class="sticky top-24 rounded-2xl bg-slate-950 text-white p-6 shadow-xl">
            <p class="text-xs font-semibold uppercase tracking-wider text-cyan-300">Your plan</p>
            <p class="mt-1 text-sm text-white/55">{{ est().tier }} · {{ est().summary }}</p>

            <!-- HERO: the monthly subscription, the product -->
            <p class="mt-3 text-4xl font-bold tracking-tight">{{ money(est().monthly) }}<span class="text-lg font-medium text-white/50"> / month</span></p>
            <p class="text-sm text-white/60">{{ est().tier }} plan · {{ est().controllers }} controller{{ est().controllers > 1 ? 's' : '' }}</p>

            <!-- the pack, optional, also monthly -->
            <div class="mt-4 flex justify-between gap-3 text-sm border-t border-white/10 pt-4">
              <span class="text-white/70">{{ est().pack.label }} pack <span class="text-white/40">· optional</span></span>
              <span class="tabular-nums">+ {{ packPrice() }}</span>
            </div>

            <!-- one-time kit, demoted: hardware, near cost -->
            <div class="mt-4 border-t border-white/10 pt-4">
              <div class="flex justify-between gap-3 text-sm">
                <span class="text-white/70">One-time kit </span>
                <span class="tabular-nums">{{ money(est().oneTime) }}</span>
              </div>
              <ul class="mt-2 space-y-1.5 text-xs text-white/50">
                @for (l of est().lines; track l.label) {
                  <li class="flex justify-between gap-3">
                    <span>{{ l.label }}@if (l.qty > 1) { <span class="text-white/35"> × {{ l.qty }}</span> }</span>
                    <span class="tabular-nums">{{ money(l.total) }}</span>
                  </li>
                }
              </ul>
            </div>

            <p class="mt-4 text-xs text-white/45 leading-relaxed">
              The monthly is the platform: offsite access, graphs, alerts, and automations you build online. On-site it still works without it: local control, pump safety and your saved automations keep running, no subscription.
            </p>

            <p class="mt-3 text-xs text-white/45 leading-relaxed">
              {{ est().controllers }} controller{{ est().controllers > 1 ? 's' : '' }} ·
              each has 16 relays (a valve uses 2{{ threePhase() ? '' : ', a pump 1' }}), {{ caps.flow }} flow sensors, {{ caps.tanks }} tanks onboard, plus more on a metering hub.
            </p>

            @if (est().multiController) {
              <p class="mt-3 rounded-lg bg-amber-400/10 ring-1 ring-amber-300/30 text-amber-200 text-xs p-3 leading-relaxed">
                Your site needs more than one controller. Each runs on its own and shares one dashboard;
                they don't coordinate or share sensors. Need them to work as one?
                <a routerLink="/" class="underline">Let's talk.</a>
              </p>
            }
            @if (largeSize()) {
              <p class="mt-3 rounded-lg bg-cyan-400/10 ring-1 ring-cyan-300/30 text-cyan-100 text-xs p-3 leading-relaxed">
                Bigger-than-3/4" parts are quoted separately and not in this figure.
              </p>
            }
            @if (bigPump() && !threePhase()) {
              <p class="mt-3 rounded-lg bg-cyan-400/10 ring-1 ring-cyan-300/30 text-cyan-100 text-xs p-3 leading-relaxed">
                Pumps over about 2 hp need a contactor, quoted separately and not in this figure.
              </p>
            }
            @if (threePhase()) {
              <p class="mt-3 rounded-lg bg-cyan-400/10 ring-1 ring-cyan-300/30 text-cyan-100 text-xs p-3 leading-relaxed">
                3-phase pumps run over your own inverter, so they add no relay cost. We don't yet
                support every inverter brand, so we confirm yours first.
              </p>
            }

            <p class="mt-4 text-[11px] text-white/40 leading-relaxed">
              An estimate, not a final quote. The real price depends on a site survey, pipe sizes,
              and install. Prices in KES.
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- LEAD CAPTURE -->
    <section class="px-5 sm:px-8 pb-20">
      <div class="max-w-2xl mx-auto rounded-2xl ring-1 ring-slate-200 bg-slate-50 p-7">
        @if (submitState() === 'done') {
          <div class="text-center py-6">
            <div class="w-12 h-12 mx-auto rounded-full bg-cyan-100 text-cyan-700 flex items-center justify-center mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <h2 class="text-xl font-bold">Got it. Thank you.</h2>
            <p class="mt-2 text-sm text-slate-600">We'll be in touch about your quote. Your estimate is still on this page if you want to tweak the numbers.</p>
          </div>
        } @else {
          <h2 class="text-xl font-bold tracking-tight">Want this as a formal quote?</h2>
          <p class="mt-1.5 text-sm text-slate-600 leading-relaxed">
            Leave your details and we'll follow up. We only use them to contact you about this quote, and we won't share them.
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

            <!-- Honeypot: hidden from people, tempting to bots. Must stay empty. -->
            <input type="text" tabindex="-1" autocomplete="off" aria-hidden="true"
                   [value]="hp()" (input)="hp.set(inputValue($event))"
                   class="hidden" />
          </div>

          <label class="mt-4 flex items-start gap-3 cursor-pointer">
            <input type="checkbox" [checked]="consent()" (change)="consent.set(isChecked($event))"
                   class="mt-0.5 w-4 h-4 accent-cyan-500" />
            <span class="text-sm text-slate-700">I agree to be contacted about this quote.</span>
          </label>

          <p class="mt-2 text-xs text-slate-500">Give us a phone or email so we can reach you.</p>

          @if (submitState() === 'error') {
            <p class="mt-3 text-sm text-rose-600">{{ errorMsg() }}</p>
          }

          <button type="button" (click)="submit()" [disabled]="!canSubmit() || submitState() === 'sending'"
                  class="mt-5 w-full rounded-full px-5 py-3 text-sm font-semibold bg-cyan-500 text-white hover:bg-cyan-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {{ submitState() === 'sending' ? 'Sending…' : 'Send me this quote' }}
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

  constructor() {
    applyPageSeo({
      title: 'Pricing | MajiFlow water monitoring and control',
      description:
        'See what water monitoring and control costs for your site. Answer three questions for a live estimate of the hosted plan. Every shilling traces to real hardware on your farm or site.',
      path: 'pricing',
    });
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

  // The framing question. Picks the dashboard a customer would get and the pack we
  // pitch — never gates what they can buy.
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

  // --- Lead form ---
  protected readonly name = signal('');
  protected readonly phone = signal('');
  protected readonly email = signal('');
  protected readonly consent = signal(false);
  protected readonly hp = signal(''); // honeypot
  protected readonly submitState = signal<SubmitState>('idle');
  protected readonly errorMsg = signal('');

  protected readonly canSubmit = computed(
    () => this.name().trim() !== '' && this.consent() && (this.phone().trim() !== '' || this.email().trim() !== ''),
  );

  protected money(n: number): string {
    return kes(n);
  }

  /** The pitched pack's price line: "from KES X / mo", or "on request" until set. */
  protected packPrice(): string {
    const p = this.est().pack.fromMonthly;
    return p !== null ? 'from ' + kes(p) + ' / mo' : 'on request';
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
    return t instanceof HTMLInputElement ? t.value : '';
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
        estimate: this.est(),
        hp: this.hp(),
      });
      this.submitState.set('done');
    } catch {
      this.errorMsg.set('Could not send right now. Please try again, or reach us directly.');
      this.submitState.set('error');
    }
  }
}
