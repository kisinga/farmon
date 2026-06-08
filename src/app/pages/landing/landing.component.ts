import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { BRAND_LOGO_SVG } from '../../shared/brand-logo';

const GITHUB_URL = 'https://github.com/kisinga/majiflow';

/** A way to run MajiFlow, shown side by side so the cloud-vs-own-it trade is honest. */
interface Plan {
  name: string;
  mode: string;
  tagline: string;
  features: string[];
  /** Headline figure, e.g. "From KES 30,000". */
  price?: string;
  /** Small print under the price, e.g. "per controller · + KES 4,000/year". */
  priceNote?: string;
  footnote?: string;
  badge?: string;
  highlighted?: boolean;
  /** Call-to-action: defaults to "Get started" → /login. */
  ctaLabel?: string;
  ctaLink?: string;
}

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
 *
 * Carries the brand-level story the old static homepage held (designer →
 * generate → monitor, the verticals, the use-cases) reconciled to the current
 * managed/local model: internet is for offsite eyes, the controller stays
 * autonomous on link loss, and you choose who runs the backend.
 */
@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [RouterLink],
  host: { class: 'flex-1 overflow-y-auto bg-white text-slate-900' },
  styles: [`
    @keyframes ripple-pulse { 0%,100% { opacity:.6; transform:scale(1);} 50% { opacity:1; transform:scale(1.05);} }
    @keyframes float-glow   { 0%,100% { transform:translate(0,0) scale(1);} 50% { transform:translate(2rem,-1.5rem) scale(1.12);} }
    @keyframes ripple-ring  { 0% { transform:scale(.5); opacity:.55;} 80% { opacity:0;} 100% { transform:scale(1.75); opacity:0;} }
    .ripple      { animation: ripple-pulse 5s ease-in-out infinite; transform-origin:center; }
    .glow-blob   { animation: float-glow 14s ease-in-out infinite; }
    .ripple-ring { animation: ripple-ring 4s ease-out infinite; transform-origin:center; }
  `],
  template: `
    <!-- ============================= NAV ============================= -->
    <nav class="sticky top-0 z-30 backdrop-blur-md bg-slate-950/80 border-b border-white/10">
      <div class="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
        <a href="./" class="flex items-center gap-2.5 group">
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

    <!-- ============================= HERO ============================= -->
    <header class="relative overflow-hidden bg-slate-950 text-white">
      <!-- decorative water-light blobs -->
      <div class="glow-blob pointer-events-none absolute -top-24 -left-16 w-[28rem] h-[28rem] rounded-full bg-cyan-500/25 blur-3xl"></div>
      <div class="glow-blob pointer-events-none absolute top-10 right-0 w-[24rem] h-[24rem] rounded-full bg-sky-500/20 blur-3xl" style="animation-delay:-6s"></div>

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
          <span class="w-1.5 h-1.5 rounded-full bg-cyan-300"></span> Plan it · We build it · You watch it
        </span>
        <h1 class="text-4xl sm:text-6xl font-bold leading-[1.05] tracking-tight">
          Watch and control your
          <span class="bg-gradient-to-r from-cyan-300 via-sky-300 to-blue-300 bg-clip-text text-transparent">water</span>,
          from anywhere.
        </h1>
        <p class="mt-7 text-base sm:text-xl text-white/70 max-w-2xl mx-auto leading-relaxed">
          For farms, hotels, greenhouses and boreholes. Anywhere water really matters.
          Lay out your tanks, pumps, valves and sensors on the screen, and we set up the
          controllers, build your live dashboard, and hand you a clear wiring guide.
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
        <h2 class="text-2xl sm:text-3xl font-bold tracking-tight">Your whole site, on one screen</h2>
        <p class="mt-3 text-sm sm:text-base text-slate-600 leading-relaxed max-w-2xl mx-auto">
          Live tank levels, water flow and valve positions in a single view. Watch it from
          your laptop or your phone, on-site or across the country.
        </p>
      </div>

      <div class="relative max-w-5xl mx-auto mt-10 sm:mt-12">
        <!-- desktop: browser-chrome frame -->
        <div class="rounded-2xl bg-white ring-1 ring-slate-200 shadow-2xl shadow-slate-900/10 overflow-hidden">
          <div class="flex items-center gap-1.5 px-4 h-9 bg-slate-100 border-b border-slate-200">
            <span class="w-3 h-3 rounded-full bg-red-400/70"></span>
            <span class="w-3 h-3 rounded-full bg-amber-400/70"></span>
            <span class="w-3 h-3 rounded-full bg-green-400/70"></span>
            <span class="ml-3 hidden sm:block rounded-md bg-white ring-1 ring-slate-200 px-3 py-0.5 text-[11px] text-slate-400">majiflow.app / dashboard</span>
          </div>
          <div class="aspect-[16/10] overflow-hidden bg-slate-950">
            <img src="marketing/desktop.png" alt="The MajiFlow dashboard showing routes, status, tank levels and valves" class="w-full object-cover object-top" />
          </div>
        </div>
        <!-- phone: overlapping frame (desktop screens only) -->
        <div class="hidden lg:block absolute -bottom-8 -right-4 w-44 rounded-[1.75rem] bg-slate-900 ring-1 ring-white/10 shadow-2xl p-1.5">
          <div class="rounded-[1.3rem] overflow-hidden bg-white">
            <div class="aspect-[9/19] overflow-hidden bg-slate-950">
              <img src="marketing/mobile.png" alt="MajiFlow on a phone" class="w-full object-cover object-top" />
            </div>
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
        <!-- the controller itself -->
        <div class="mt-8 grid gap-6 sm:grid-cols-2 items-center">
          <div class="rounded-2xl ring-1 ring-slate-200 shadow-xl shadow-slate-900/10 overflow-hidden">
            <img src="marketing/controller.jpg" alt="The controller that runs your site" class="block w-full aspect-[16/10] object-cover" />
          </div>
          <div>
            <h3 class="text-lg font-semibold">The controller that runs your site</h3>
            <p class="mt-2 text-sm text-slate-600 leading-relaxed">
              Out in the field, each controller reads your sensors, switches your pumps and valves,
              and reports back to your dashboard. Mount it on a wall or a rail, wire it once, and
              leave it. Let us host it online for the lowest cost, or keep everything on-site and own it yourself.
            </p>
          </div>
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
          <p class="mt-1.5 text-sm text-slate-600 leading-relaxed">See tank levels, water flow and valve positions in one place. Know what is happening even when you are miles away.</p>
        </div>
      </div>
    </section>

    <!-- ===================== TWO WAYS TO RUN IT (PLANS) ===================== -->
    <section class="px-5 sm:px-8 py-16 sm:py-24">
      <div class="max-w-6xl mx-auto">
        <div class="text-center max-w-2xl mx-auto">
          <h2 class="text-2xl sm:text-3xl font-bold tracking-tight">Two ways to run it</h2>
          <p class="mt-3 text-sm sm:text-base text-slate-600 leading-relaxed">
            Same app, same dashboard. The choice is simple: let us host it for you online,
            or keep everything on-site and own it. Here is what each one costs and includes.
          </p>
        </div>

        <div class="mt-12 grid gap-6 md:grid-cols-2 max-w-3xl mx-auto items-start">
          @for (plan of plans; track plan.name) {
            <div class="relative rounded-2xl bg-white p-7 transition-all hover:-translate-y-1"
                 [class]="plan.highlighted
                   ? 'ring-2 ring-cyan-500 shadow-2xl shadow-cyan-500/15'
                   : 'ring-1 ring-slate-200 shadow-sm'">
              @if (plan.badge) {
                <span class="absolute -top-3 left-7 rounded-full bg-cyan-500 text-white text-xs font-semibold px-3 py-1 shadow">{{ plan.badge }}</span>
              }
              <p class="text-xs font-semibold uppercase tracking-wider text-cyan-600">{{ plan.mode }}</p>
              <h3 class="mt-1 text-xl font-bold">{{ plan.name }}</h3>
              @if (plan.price) {
                <p class="mt-3 text-3xl font-bold tracking-tight">{{ plan.price }}</p>
                @if (plan.priceNote) {
                  <p class="text-xs text-slate-500">{{ plan.priceNote }}</p>
                }
              }
              <p class="mt-3 text-sm text-slate-600 leading-relaxed">{{ plan.tagline }}</p>
              <ul class="mt-5 space-y-2.5 text-sm">
                @for (f of plan.features; track f) {
                  <li class="flex gap-2.5">
                    <svg class="shrink-0 mt-0.5 text-cyan-500" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    <span class="text-slate-700">{{ f }}</span>
                  </li>
                }
              </ul>
              @if (plan.footnote) {
                <p class="mt-5 pt-4 border-t border-slate-100 text-xs text-slate-500">{{ plan.footnote }}</p>
              }
              <a [routerLink]="plan.ctaLink ?? '/login'"
                 class="mt-6 block text-center rounded-full px-5 py-2.5 text-sm font-semibold transition-colors"
                 [class]="plan.highlighted
                   ? 'bg-cyan-500 text-white hover:bg-cyan-400'
                   : 'ring-1 ring-slate-300 text-slate-800 hover:bg-slate-50'">
                {{ plan.ctaLabel ?? 'Get started' }}
              </a>
            </div>
          }
        </div>

        <p class="mt-8 text-center text-sm text-slate-500 max-w-2xl mx-auto">
          Either way, you only need internet to check in while you are away. On-site, your
          controllers keep working on their own. Want exact numbers for the hosted plan?
          <a routerLink="/pricing" class="font-semibold text-cyan-600 hover:text-cyan-700">See what your site costs.</a>
        </p>
      </div>
    </section>

    <!-- ===================== RESILIENCE BAND ===================== -->
    <section class="relative overflow-hidden bg-slate-950 text-white px-5 sm:px-8 py-16 sm:py-20">
      <div class="glow-blob pointer-events-none absolute -bottom-24 right-1/4 w-[26rem] h-[26rem] rounded-full bg-cyan-500/15 blur-3xl"></div>
      <div class="relative max-w-5xl mx-auto text-center">
        <h2 class="text-2xl sm:text-3xl font-bold tracking-tight">Built to keep going</h2>
        <p class="mt-3 text-white/60 max-w-2xl mx-auto text-sm sm:text-base leading-relaxed">
          Water cannot wait. Your site keeps running even when things go wrong.
        </p>
        <div class="mt-10 grid gap-6 sm:grid-cols-3 text-left">
          <div class="rounded-2xl bg-white/5 ring-1 ring-white/10 p-6">
            <div class="w-10 h-10 rounded-lg bg-cyan-400/15 text-cyan-300 flex items-center justify-center mb-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
            </div>
            <h3 class="font-semibold">Battery and solar</h3>
            <p class="mt-1.5 text-sm text-white/60 leading-relaxed">Add the on-site setup and battery plus solar keep things running right through a power cut.</p>
          </div>
          <div class="rounded-2xl bg-white/5 ring-1 ring-white/10 p-6">
            <div class="w-10 h-10 rounded-lg bg-cyan-400/15 text-cyan-300 flex items-center justify-center mb-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.86a10 10 0 0 1 14 0"/><path d="M8.5 16.43a5 5 0 0 1 7 0"/></svg>
            </div>
            <h3 class="font-semibold">Works without internet</h3>
            <p class="mt-1.5 text-sm text-white/60 leading-relaxed">Every controller follows its own watering schedule and safety checks. Lose the internet and your site simply carries on.</p>
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
                  <img [src]="d.design" [alt]="d.title + ' design'" class="block w-full aspect-[16/10] object-contain bg-slate-50" />
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
    <section class="px-5 sm:px-8 py-16 sm:py-20 bg-slate-50">
      <div class="max-w-5xl mx-auto">
        <h2 class="text-2xl sm:text-3xl font-bold tracking-tight text-center">Works in</h2>
        <div class="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          @for (v of verticals; track v.title) {
            <div class="rounded-xl p-6 bg-white ring-1 ring-slate-200">
              <h3 class="font-semibold text-cyan-700">{{ v.title }}</h3>
              <p class="mt-1.5 text-sm text-slate-600 leading-relaxed">{{ v.body }}</p>
            </div>
          }
        </div>
      </div>
    </section>

    <!-- ===================== CTA BAND ===================== -->
    <section class="px-5 sm:px-8 py-20">
      <div class="max-w-4xl mx-auto rounded-3xl bg-gradient-to-br from-cyan-500 via-sky-600 to-blue-700 px-8 py-14 text-center text-white shadow-2xl shadow-cyan-500/20">
        <h2 class="text-2xl sm:text-4xl font-bold tracking-tight">Ready to plan your site?</h2>
        <p class="mt-3 text-white/85 max-w-xl mx-auto">Draw your site on the screen, and we will get everything ready to build and run it.</p>
        <div class="mt-8 flex flex-wrap gap-3 justify-center">
          <a routerLink="/login" class="rounded-full px-6 py-3 text-sm font-semibold bg-white text-slate-900 hover:bg-slate-100 transition-colors">Get started</a>
          <a [href]="github" target="_blank" rel="noopener" class="rounded-full px-6 py-3 text-sm font-semibold ring-1 ring-white/40 text-white hover:bg-white/10 transition-colors">View on GitHub</a>
        </div>
      </div>
    </section>

    <!-- ===================== FOOTER ===================== -->
    <footer class="bg-slate-950 text-slate-400 px-5 sm:px-8 py-10">
      <div class="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <div class="flex items-center gap-2.5">
          <span class="w-6 h-6 block" [innerHTML]="logo"></span>
          <span class="font-semibold text-white">MajiFlow</span>
        </div>
        <p class="text-sm text-center">Started on a dry-land farm. Built where water is critical.</p>
        <a [href]="github" target="_blank" rel="noopener" class="text-sm hover:text-white transition-colors">Open source on GitHub →</a>
      </div>
    </footer>
  `,
})
export class LandingComponent {
  protected readonly github = GITHUB_URL;

  /** Sanitizer-trusted brand mark (static SVG), rendered via [innerHTML]. */
  protected readonly logo: SafeHtml = inject(DomSanitizer).bypassSecurityTrustHtml(BRAND_LOGO_SVG);

  protected readonly plans: Plan[] = [
    {
      name: 'Hosted',
      mode: 'Hosted by us',
      price: 'From KES 30,000',
      priceNote: 'per controller · + KES 4,000/year after year one',
      tagline: 'The simplest, lowest-cost way to get your water online. We run everything for you; you just sign in to watch and control.',
      badge: 'Most popular',
      highlighted: true,
      features: [
        'One controller bundle: a KC868 controller, pump control, one valve, one flow sensor, one tank monitor, a power supply, and a clock that survives power cuts',
        'Add more on the same controller: about KES 3,000 a valve, 3,000 a flow sensor, 4,000 a tank monitor. One controller fits up to 7 valves, 3 flow sensors and 4 tanks',
        'Outgrow it? Another full controller for KES 30,000. Each one runs on its own (on Hosted they do not share sensors or talk to each other)',
        'We host it online and keep it up with an uptime guarantee; live dashboard, full history, and instant alerts',
      ],
      footnote: 'No power backup: if the mains goes out, the controller stops, then restarts on its schedule when power returns. Internet is only needed to check in while you are away.',
      ctaLabel: 'See what your site costs',
      ctaLink: '/pricing',
    },
    {
      name: 'On-site, own it',
      mode: 'Runs on-site · you own it',
      price: 'From KES 200,000',
      priceNote: 'tailored to your site',
      tagline: 'Keep everything on your own property and own it outright. Built to keep going no matter what.',
      features: [
        'An on-site hub runs your whole site by itself, even with no internet',
        'Battery and solar keep it working straight through power cuts',
        'Your controllers work together and share sensors across the whole site',
        'Reach it from anywhere over your own private connection, so your data never passes through us',
        'You own everything; nothing depends on us to keep your site running day to day',
      ],
      footnote: 'A build sized to your site, so the price is tailored. You still need internet to check in while you are away.',
      ctaLabel: 'Talk to us',
    },
  ];

  protected readonly capabilities: Capability[] = [
    { title: 'Keep an eye from anywhere', body: 'Tank levels, water flow and valve positions in one dashboard, whether you are on-site or across the country.' },
    { title: 'Know how much you use', body: 'Field A used 10,300 litres this week. The main tank has held 85% for two days. See it all in one place.' },
    { title: 'Take action from your phone', body: 'Reservoir down to 8%? Switch on the pump from your phone. No need to drive out to the site.' },
    { title: 'Let the routine run itself', body: 'Fill the reservoir at 6 AM on Mondays, or whenever it drops below 30%. Set it once and forget it.' },
  ];

  protected readonly verticals: Vertical[] = [
    { title: 'Farms', body: 'Automatic irrigation and remote pump control, for small plots and large commercial farms alike.' },
    { title: 'Hotels and lodges', body: 'Balanced tanks, steady water pressure, and early leak warnings for guest sites.' },
    { title: 'Greenhouses', body: 'Automatic feeding and dosing, with watering that follows the weather.' },
    { title: 'Remote sites', body: 'Solar-powered monitoring for boreholes, dams, and places with no grid power.' },
  ];

  protected readonly deployments: Deployment[] = [
    {
      title: 'Dryland farm',
      body: 'Rain tank and borehole feeding two fields through a shared pump and valves.',
      design: 'marketing/deploy-1-design.png',
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
