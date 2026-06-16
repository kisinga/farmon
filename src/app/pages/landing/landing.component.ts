import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { BRAND_LOGO_SVG } from '../../shared/brand-logo';
import { applyPageSeo } from '../../shared/seo';
import {
  HardwareShowcaseComponent,
  HARDWARE_DEVICES,
} from '../../shared/hardware-showcase/hardware-showcase.component';
import { MarketingNavComponent, GITHUB_URL } from '../../shared/marketing/marketing-nav.component';
import { MarketingFooterComponent } from '../../shared/marketing/marketing-footer.component';
import { MarketingCtaComponent, type CtaButton } from '../../shared/marketing/marketing-cta.component';
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
 * Carries the brand-level story (designer → generate → monitor, the verticals,
 * the use-cases): the hosted platform is the product, sold as a per-controller
 * monthly subscription plus a one-time near-cost hardware kit. The controller
 * stays autonomous on link loss — local control works without the subscription.
 * Leads with the water-monitoring-and-control keyword and a water-conservation
 * throughline.
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
  ],
  host: { class: 'flex-1 overflow-y-auto bg-white text-slate-900' },
  styles: [`
    @keyframes ripple-pulse { 0%,100% { opacity:.6; transform:scale(1);} 50% { opacity:1; transform:scale(1.05);} }
    @keyframes float-glow   { 0%,100% { transform:translate(0,0) scale(1);} 50% { transform:translate(2rem,-1.5rem) scale(1.12);} }
    @keyframes ripple-ring  { 0% { transform:scale(.5); opacity:.55;} 80% { opacity:0;} 100% { transform:scale(1.75); opacity:0;} }
    .ripple      { animation: ripple-pulse 5s ease-in-out infinite; transform-origin:center; }
    .glow-blob   { animation: float-glow 14s ease-in-out infinite; }
    .ripple-ring { animation: ripple-ring 4s ease-out infinite; transform-origin:center; }
    @media (prefers-reduced-motion: reduce) {
      .ripple, .glow-blob, .ripple-ring { animation: none; }
    }
  `],
  template: `
    <!-- ============================= NAV ============================= -->
    <app-marketing-nav />

    <!-- ============================= HERO ============================= -->
    <header class="relative overflow-hidden bg-slate-950 text-white">
      <!-- decorative water-light blobs -->
      <div class="glow-blob pointer-events-none absolute -top-24 -left-16 w-[28rem] h-[28rem] rounded-full bg-radial from-cyan-500/30 to-transparent to-70%"></div>
      <div class="glow-blob pointer-events-none absolute top-10 right-0 w-[24rem] h-[24rem] rounded-full bg-radial from-sky-500/25 to-transparent to-70%" style="animation-delay:-6s"></div>

      <div class="relative max-w-5xl mx-auto px-5 sm:px-8 pt-16 sm:pt-24 pb-20 sm:pb-28 text-center">
        <div class="relative mx-auto mb-9 w-28 h-28 sm:w-32 sm:h-32 flex items-center justify-center">
          <span class="absolute inset-0 rounded-full ring-1 ring-cyan-400/30 ripple-ring"></span>
          <span class="absolute inset-0 rounded-full ring-1 ring-cyan-400/20 ripple-ring" style="animation-delay:1.3s"></span>
          <span class="absolute inset-0 rounded-full ring-1 ring-cyan-400/10 ripple-ring" style="animation-delay:2.6s"></span>
          <span class="relative w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-cyan-500/10 ring-1 ring-white/10 backdrop-blur-sm flex items-center justify-center">
            <span class="ripple block w-12 h-12 sm:w-14 sm:h-14" [innerHTML]="logo"></span>
          </span>
        </div>
        <span class="inline-flex items-center gap-2 rounded-full bg-white/10 ring-1 ring-white/15 px-3 py-1 text-xs font-medium text-cyan-200 mb-6">
          <span class="w-1.5 h-1.5 rounded-full bg-cyan-300"></span> Water monitoring and automation
        </span>
        <h1 class="text-4xl sm:text-6xl font-bold leading-[1.05] tracking-tight">
          Watch and control your
          <span class="bg-gradient-to-r from-cyan-300 via-sky-300 to-blue-300 bg-clip-text text-transparent">water</span>,
          from anywhere.
        </h1>
        <p class="mt-7 text-base sm:text-xl text-white/70 max-w-2xl mx-auto leading-relaxed">
          Water is money, and untracked water is money gone. MajiFlow meters every litre, runs your pumps
          and valves on a schedule or to an exact volume, and shows where it all goes: by field, by tank,
          by customer. No more checking tanks by hand or driving out to start a pump.
        </p>
        <div class="mt-9 flex flex-wrap gap-3 justify-center">
          <a routerLink="/login"
             class="rounded-full px-6 py-3 text-sm font-semibold bg-cyan-400 text-slate-950 hover:bg-cyan-300 shadow-lg shadow-cyan-500/25 transition-all hover:-translate-y-0.5">
            Get started
          </a>
          <a [href]="github" target="_blank" rel="noopener"
             class="rounded-full px-6 py-3 text-sm font-semibold ring-1 ring-white/25 text-white hover:bg-white/10 transition-colors">
            View on GitHub
          </a>
        </div>
        <p class="mt-6 text-xs text-white/45">
          Your controllers keep working on their own, whether the internet is up or not.
        </p>
      </div>

      <!-- wave divider into the light sections -->
      <svg class="block w-full text-white" viewBox="0 0 1440 80" preserveAspectRatio="none" aria-hidden="true">
        <path fill="currentColor" d="M0,32 C240,72 480,72 720,48 C960,24 1200,24 1440,48 L1440,80 L0,80 Z"></path>
      </svg>
    </header>

    <!-- ===================== DASHBOARD PEEK ===================== -->
    <section class="px-5 sm:px-8 pt-12 sm:pt-16 pb-4">
      <div class="max-w-5xl mx-auto text-center">
        <h2 class="text-2xl sm:text-3xl font-bold tracking-tight">See every tank, pump and valve on one screen</h2>
        <p class="mt-3 text-sm sm:text-base text-slate-600 leading-relaxed max-w-2xl mx-auto">
          Live tank levels, water flow and valve positions in a single view. Watch your farm or site
          from your laptop or your phone, on-site or across the country.
        </p>
      </div>

      <div class="relative max-w-sm sm:max-w-5xl mx-auto mt-10 sm:mt-12">
        <!-- hero screenshot: phone dashboard on small screens, desktop on sm+ -->
        <div class="rounded-2xl bg-white ring-1 ring-slate-200 shadow-2xl shadow-slate-900/10 overflow-hidden">
          <!-- fake browser chrome only fits the desktop screenshot -->
          <div class="hidden sm:flex items-center gap-1.5 px-4 h-9 bg-slate-100 border-b border-slate-200">
            <span class="w-3 h-3 rounded-full bg-red-400/70"></span>
            <span class="w-3 h-3 rounded-full bg-amber-400/70"></span>
            <span class="w-3 h-3 rounded-full bg-green-400/70"></span>
            <span class="ml-3 hidden sm:block rounded-md bg-white ring-1 ring-slate-200 px-3 py-0.5 text-[11px] text-slate-400">majiflow.io / dashboard</span>
          </div>
          <!-- Art direction by viewport: <source media> downloads only the matching
               screenshot — the phone shot on mobile, the desktop shot otherwise. -->
          <div class="aspect-[9/19] sm:aspect-[16/10] overflow-hidden bg-slate-950">
            <picture>
              <source media="(max-width: 639px)" srcset="marketing/mobile.webp" type="image/webp" />
              <img src="marketing/desktop.webp" alt="The MajiFlow water monitoring dashboard showing routes, status, tank levels and valves"
                   width="1591" height="1361" fetchpriority="high" decoding="async"
                   class="w-full h-full object-cover object-top" />
            </picture>
          </div>
        </div>
        <!-- phone: overlapping frame (desktop screens only) -->
        <div class="hidden lg:block absolute -bottom-8 -right-4 w-44 rounded-[1.75rem] bg-slate-900 ring-1 ring-white/10 shadow-2xl p-1.5">
          <div class="rounded-[1.3rem] overflow-hidden bg-white">
            <div class="aspect-[9/19] overflow-hidden bg-slate-950">
              <img src="marketing/mobile.webp" alt="MajiFlow water dashboard on a phone"
                   width="388" height="842" loading="lazy" decoding="async"
                   class="w-full object-cover object-top" />
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ===================== SAVE WATER (CONSERVATION) ===================== -->
    <section class="px-5 sm:px-8 py-16 sm:py-20 bg-slate-50">
      <div class="max-w-5xl mx-auto">
        <div class="text-center max-w-2xl mx-auto">
          <h2 class="text-2xl sm:text-3xl font-bold tracking-tight">Water you can see is water you don't waste</h2>
          <p class="mt-3 text-sm sm:text-base text-slate-600 leading-relaxed">
            On a farm, every litre counts. Most water is lost where no one is looking. A valve left open,
            a tank overflowing at night, a slow leak underground. MajiFlow puts a number on all of it.
          </p>
        </div>
        <div class="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div class="rounded-xl p-6 bg-white ring-1 ring-slate-200">
            <h3 class="font-semibold text-cyan-700">Catch leaks early</h3>
            <p class="mt-1.5 text-sm text-slate-600 leading-relaxed">Flow sensors spot a line that should be still and warn you the same day, before it drains a tank or floods a field.</p>
          </div>
          <div class="rounded-xl p-6 bg-white ring-1 ring-slate-200">
            <h3 class="font-semibold text-cyan-700">Use only what you need</h3>
            <p class="mt-1.5 text-sm text-slate-600 leading-relaxed">Tanks fill to a set level and stop, so nothing overflows and no crop is over-watered.</p>
          </div>
          <div class="rounded-xl p-6 bg-white ring-1 ring-slate-200">
            <h3 class="font-semibold text-cyan-700">Know your usage</h3>
            <p class="mt-1.5 text-sm text-slate-600 leading-relaxed">"Field A used 10,300 litres this week" turns guesswork into numbers you can plan around and cut.</p>
          </div>
          <div class="rounded-xl p-6 bg-white ring-1 ring-slate-200">
            <h3 class="font-semibold text-cyan-700">Pump on sun, not diesel</h3>
            <p class="mt-1.5 text-sm text-slate-600 leading-relaxed">Solar-run sites water the land on clean power and cut fuel, cost and carbon.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ===================== SOFTWARE + HARDWARE ===================== -->
    <section class="px-5 sm:px-8 py-16 sm:py-20">
      <div class="max-w-5xl mx-auto">
        <h2 class="text-2xl sm:text-3xl font-bold tracking-tight text-center">Software and hardware, designed together</h2>
        <div class="mt-10 grid gap-5 md:grid-cols-2">
          <div class="rounded-2xl p-7 bg-slate-50 ring-1 ring-slate-200">
            <div class="w-11 h-11 rounded-xl bg-cyan-100 text-cyan-700 flex items-center justify-center mb-4">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            </div>
            <h3 class="text-lg font-semibold">The software</h3>
            <p class="mt-2 text-sm text-slate-600 leading-relaxed">Draw your tanks, pumps and sensors on the screen. MajiFlow checks your design and flags wiring mistakes <em>before</em> you spend a shilling, then gets the controllers and your dashboard ready.</p>
          </div>
          <div class="rounded-2xl p-7 bg-slate-50 ring-1 ring-slate-200">
            <div class="w-11 h-11 rounded-xl bg-sky-100 text-sky-700 flex items-center justify-center mb-4">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            </div>
            <h3 class="text-lg font-semibold">The hardware</h3>
            <p class="mt-2 text-sm text-slate-600 leading-relaxed">Off-the-shelf controllers, sensors, pumps and valves. No special parts to hunt down. A plumber can do most of the install, and an electrician handles the pump wiring. Everything is documented.</p>
          </div>
        </div>
        <!-- the controller itself, on the cinematic hardware stage -->
        <app-hardware-showcase class="block mt-8" variant="hero" [devices]="heroDevices" [showHeader]="false" />
        <div class="mt-6 text-center">
          <a routerLink="/features" class="text-sm font-semibold text-cyan-600 hover:text-cyan-700">See the full hardware lineup →</a>
        </div>
      </div>
    </section>

    <!-- ===================== DESIGN / SET UP / MONITOR ===================== -->
    <section class="px-5 sm:px-8 py-16 sm:py-20 bg-slate-50">
      <div class="max-w-5xl mx-auto grid gap-6 sm:grid-cols-3">
        <div class="text-center sm:text-left">
          <div class="w-11 h-11 mx-auto sm:mx-0 rounded-xl bg-white ring-1 ring-slate-200 text-cyan-600 flex items-center justify-center mb-4">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </div>
          <h3 class="font-semibold">1. Design it</h3>
          <p class="mt-1.5 text-sm text-slate-600 leading-relaxed">Lay out your tanks, pumps, valves and sensors on the screen. We check it and catch mistakes before you spend money.</p>
        </div>
        <div class="text-center sm:text-left">
          <div class="w-11 h-11 mx-auto sm:mx-0 rounded-xl bg-white ring-1 ring-slate-200 text-cyan-600 flex items-center justify-center mb-4">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
          </div>
          <h3 class="font-semibold">2. We set it up</h3>
          <p class="mt-1.5 text-sm text-slate-600 leading-relaxed">We get your controllers ready to switch on, build your dashboard, and write the wiring guide. No coding, ever.</p>
        </div>
        <div class="text-center sm:text-left">
          <div class="w-11 h-11 mx-auto sm:mx-0 rounded-xl bg-white ring-1 ring-slate-200 text-cyan-600 flex items-center justify-center mb-4">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
          </div>
          <h3 class="font-semibold">3. You watch it</h3>
          <p class="mt-1.5 text-sm text-slate-600 leading-relaxed">See tank levels, water flow and valve positions in one place. Know what your farm is doing even when you are miles away.</p>
        </div>
      </div>
    </section>

    <!-- ===================== WHAT YOU CAN DO ===================== -->
    <section class="px-5 sm:px-8 py-16 sm:py-20">
      <div class="max-w-5xl mx-auto">
        <h2 class="text-2xl sm:text-3xl font-bold tracking-tight text-center">What you can do with it</h2>
        <div class="mt-10 grid gap-5 sm:grid-cols-2">
          @for (c of capabilities; track c.title) {
            <div class="rounded-xl p-6 bg-slate-50 ring-1 ring-slate-200 hover:ring-cyan-300 transition-colors">
              <h3 class="font-semibold text-slate-900">{{ c.title }}</h3>
              <p class="mt-1.5 text-sm text-slate-600 leading-relaxed">{{ c.body }}</p>
            </div>
          }
        </div>
        <div class="mt-8 text-center">
          <a routerLink="/features" class="text-sm font-semibold text-cyan-600 hover:text-cyan-700">See everything MajiFlow does →</a>
        </div>
      </div>
    </section>

    <!-- ===================== FROM DESIGN TO THE FIELD ===================== -->
    <section class="px-5 sm:px-8 py-16 sm:py-20 bg-slate-50">
      <div class="max-w-6xl mx-auto">
        <div class="text-center max-w-2xl mx-auto">
          <h2 class="text-2xl sm:text-3xl font-bold tracking-tight">From design to the field</h2>
          <p class="mt-3 text-sm sm:text-base text-slate-600 leading-relaxed">
            Real sites we have planned and built. The same layout you draw on the screen
            becomes the controllers, pumps and valves running on the ground.
          </p>
        </div>
        <div class="mt-12 grid gap-6 md:grid-cols-3">
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
      </div>
    </section>

    <!-- ===================== WORKS IN ===================== -->
    <section class="px-5 sm:px-8 py-16 sm:py-20">
      <div class="max-w-5xl mx-auto">
        <h2 class="text-2xl sm:text-3xl font-bold tracking-tight text-center">Water monitoring for farms, hotels, greenhouses and boreholes</h2>
        <div class="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          @for (v of verticals; track v.title) {
            <div class="rounded-xl p-6 bg-slate-50 ring-1 ring-slate-200">
              <h3 class="font-semibold text-cyan-700">{{ v.title }}</h3>
              <p class="mt-1.5 text-sm text-slate-600 leading-relaxed">{{ v.body }}</p>
            </div>
          }
        </div>
      </div>
    </section>

    <!-- ===================== PRICING ===================== -->
    <section class="px-5 sm:px-8 py-16 sm:py-24 bg-slate-50">
      <div class="max-w-4xl mx-auto">
        <div class="text-center max-w-2xl mx-auto">
          <h2 class="text-2xl sm:text-3xl font-bold tracking-tight">Simple, honest pricing</h2>
          <p class="mt-3 text-sm sm:text-base text-slate-600 leading-relaxed">
            Pay monthly for the platform. Add a one-time kit to run it. Nothing hidden, no lock-in.
          </p>
        </div>

        <div class="mt-12 rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-7 sm:p-9 max-w-2xl mx-auto">
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
      </div>
    </section>

    <!-- ===================== RESILIENCE BAND ===================== -->
    <section class="relative overflow-hidden bg-slate-950 text-white px-5 sm:px-8 py-16 sm:py-20">
      <div class="glow-blob pointer-events-none absolute -bottom-24 right-1/4 w-[26rem] h-[26rem] rounded-full bg-radial from-cyan-500/20 to-transparent to-70%"></div>
      <div class="relative max-w-5xl mx-auto text-center">
        <h2 class="text-2xl sm:text-3xl font-bold tracking-tight">Built to keep going</h2>
        <p class="mt-3 text-white/60 max-w-2xl mx-auto text-sm sm:text-base leading-relaxed">
          Water cannot wait, and neither can a thirsty crop. Your site keeps running even when things go wrong.
        </p>
        <div class="mt-10 grid gap-6 sm:grid-cols-3 text-left">
          <div class="rounded-2xl bg-white/5 ring-1 ring-white/10 p-6">
            <div class="w-10 h-10 rounded-lg bg-cyan-400/15 text-cyan-300 flex items-center justify-center mb-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
            </div>
            <h3 class="font-semibold">Battery and solar</h3>
            <p class="mt-1.5 text-sm text-white/60 leading-relaxed">Add battery and solar and your site runs right through a power cut, cleaner and cheaper than a diesel pump.</p>
          </div>
          <div class="rounded-2xl bg-white/5 ring-1 ring-white/10 p-6">
            <div class="w-10 h-10 rounded-lg bg-cyan-400/15 text-cyan-300 flex items-center justify-center mb-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.86a10 10 0 0 1 14 0"/><path d="M8.5 16.43a5 5 0 0 1 7 0"/></svg>
            </div>
            <h3 class="font-semibold">Works offline, even unsubscribed</h3>
            <p class="mt-1.5 text-sm text-white/60 leading-relaxed">On-site, local control, pump safety and your saved automations keep running with no internet and no subscription. The plan adds the offsite half: remote access, graphs, alerts, and automations you build online.</p>
          </div>
          <div class="rounded-2xl bg-white/5 ring-1 ring-white/10 p-6">
            <div class="w-10 h-10 rounded-lg bg-cyan-400/15 text-cyan-300 flex items-center justify-center mb-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>
            </div>
            <h3 class="font-semibold">We keep it online</h3>
            <p class="mt-1.5 text-sm text-white/60 leading-relaxed">Choose the hosted plan and we run everything online and keep it up, so there is nothing for you to manage.</p>
          </div>
        </div>
      </div>
    </section>

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
  protected readonly github = GITHUB_URL;

  /** Sanitizer-trusted brand mark (static SVG), rendered via [innerHTML]. */
  protected readonly logo: SafeHtml = inject(DomSanitizer).bypassSecurityTrustHtml(BRAND_LOGO_SVG);

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
    { label: 'Get started', route: '/login' },
    { label: 'View on GitHub', href: GITHUB_URL },
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
