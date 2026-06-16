import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { AuthStore } from '../../core/services/auth.store';
import { BRAND_LOGO_SVG } from '../../shared/brand-logo';

/**
 * Sign-in page (route `/login`). Renders full-bleed in the same dark, glassy,
 * water-themed language as the public landing (the app shell hides its chrome
 * here, via `isPublic`).
 */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, RouterLink],
  host: { class: 'flex-1 overflow-y-auto bg-slate-950 text-white' },
  template: `
    <div class="relative min-h-full flex items-center justify-center p-4 overflow-hidden">
      <!-- water-light glow (shared marketing decoration utilities) -->
      <div class="mkt-glow-blob pointer-events-none absolute -top-20 -left-16 w-[26rem] h-[26rem] rounded-full bg-cyan-500/20 blur-3xl"></div>
      <div class="mkt-glow-blob pointer-events-none absolute -bottom-24 right-0 w-[24rem] h-[24rem] rounded-full bg-sky-500/15 blur-3xl" style="animation-delay:-6s"></div>

      <div class="relative w-full max-w-sm">
        <!-- brand -->
        <a routerLink="/" class="flex flex-col items-center gap-3 mb-8">
          <span class="mkt-ripple block w-14 h-14" [innerHTML]="logo"></span>
          <span class="text-xl font-bold tracking-tight">MajiFlow</span>
        </a>

        <div class="rounded-2xl bg-white/5 ring-1 ring-white/10 backdrop-blur-md p-7 shadow-2xl shadow-cyan-500/10">
          <h1 class="text-lg font-semibold text-center">Welcome back</h1>
          <p class="mt-1 text-sm text-white/50 text-center">Sign in to your dashboard.</p>

          <form class="mt-6 space-y-4" (ngSubmit)="submit()">
            <div>
              <label class="block text-xs font-medium text-white/60 mb-1.5" for="email">Email</label>
              <input
                id="email"
                type="email"
                name="email"
                [(ngModel)]="email"
                autocomplete="username"
                required
                placeholder="you@example.com"
                class="w-full rounded-lg bg-white/5 ring-1 ring-white/15 focus:ring-2 focus:ring-cyan-400 outline-none px-3.5 py-2.5 text-sm text-white placeholder-white/30 transition"
              />
            </div>

            <div>
              <label class="block text-xs font-medium text-white/60 mb-1.5" for="password">Password</label>
              <input
                id="password"
                type="password"
                name="password"
                [(ngModel)]="password"
                autocomplete="current-password"
                required
                placeholder="••••••••"
                class="w-full rounded-lg bg-white/5 ring-1 ring-white/15 focus:ring-2 focus:ring-cyan-400 outline-none px-3.5 py-2.5 text-sm text-white placeholder-white/30 transition"
              />
            </div>

            @if (error()) {
              <p class="text-sm text-rose-300 bg-rose-500/10 ring-1 ring-rose-500/20 rounded-lg px-3 py-2">{{ error() }}</p>
            }

            <button
              type="submit"
              [disabled]="loading()"
              class="w-full rounded-full bg-cyan-400 text-slate-950 font-semibold text-sm px-5 py-2.5 hover:bg-cyan-300 disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              @if (loading()) {
                <span class="w-4 h-4 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin"></span>
              }
              Sign in
            </button>
          </form>
        </div>

        <a routerLink="/" class="mt-6 block text-center text-xs text-white/40 hover:text-white/70 transition-colors">Back to home</a>
      </div>
    </div>
  `,
})
export class LoginComponent {
  private auth = inject(AuthStore);
  private router = inject(Router);

  protected readonly logo: SafeHtml = inject(DomSanitizer).bypassSecurityTrustHtml(BRAND_LOGO_SVG);

  protected email = '';
  protected password = '';
  protected loading = signal(false);
  protected error = signal<string | null>(null);

  protected async submit(): Promise<void> {
    if (!this.email || !this.password) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.auth.login(this.email, this.password);
      // /home routes by role: admins → /overview, customers → their dashboard.
      await this.router.navigate(['/home']);
    } catch {
      this.error.set('Invalid email or password.');
    } finally {
      this.loading.set(false);
    }
  }
}
