import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterOutlet, RouterLink, Router, NavigationEnd } from '@angular/router';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { ElectronService } from './core/services/electron.service';
import type { HealthReport } from './core/models/electron-api';
import { filter } from 'rxjs';

const LOGO_SVG = `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="width:100%;height:100%;display:block">
  <defs>
    <linearGradient id="sf" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#1e3a20"/><stop offset="100%" stop-color="#142116"/></linearGradient>
    <linearGradient id="ss" x1="0" y1="0" x2="0.5" y2="1"><stop offset="0%" stop-color="#66bb6a"/><stop offset="100%" stop-color="#2e7d32"/></linearGradient>
    <linearGradient id="st" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#4caf50"/><stop offset="100%" stop-color="#2e7d32"/></linearGradient>
    <linearGradient id="lf" x1="0" y1="1" x2="1" y2="0"><stop offset="0%" stop-color="#2e7d32"/><stop offset="100%" stop-color="#66bb6a"/></linearGradient>
  </defs>
  <path d="M 60,6 L 104,24 L 104,58 C 104,86 78,110 60,116 C 42,110 16,86 16,58 L 16,24 Z" fill="url(#sf)" stroke="url(#ss)" stroke-width="2.5"/>
  <line x1="60" y1="54" x2="60" y2="82" stroke="url(#st)" stroke-width="3" stroke-linecap="round"/>
  <path d="M 60,54 C 60,44 69,32 80,26 C 82,36 75,52 62,56 Z" fill="url(#lf)" opacity=".9"/>
  <path d="M 61,54 C 66,46 72,36 78,28" stroke="#a5d6a7" stroke-width=".7" fill="none" opacity=".4"/>
  <path d="M 60,62 C 54,56 44,52 38,50 C 42,58 54,64 60,64 Z" fill="#4caf50" opacity=".55"/>
  <circle cx="60" cy="82" r="3" fill="#4caf50"/>
  <circle cx="60" cy="82" r="6.5" fill="none" stroke="#4caf50" stroke-width="1.2" opacity=".4"/>
  <circle cx="60" cy="82" r="11" fill="none" stroke="#4caf50" stroke-width="1" opacity=".22"/>
  <circle cx="60" cy="82" r="16" fill="none" stroke="#388e3c" stroke-width=".8" opacity=".12"/>
  <circle cx="38" cy="88" r="1.5" fill="#66bb6a" opacity=".45"/>
  <circle cx="82" cy="88" r="1.5" fill="#66bb6a" opacity=".45"/>
  <circle cx="60" cy="100" r="1.5" fill="#66bb6a" opacity=".3"/>
</svg>`;

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  private electron = inject(ElectronService);
  private router = inject(Router);
  private sanitizer = inject(DomSanitizer);

  protected logoSvg: SafeHtml;
  protected health = signal<HealthReport | null>(null);
  protected showHealth = signal(false);
  protected fixing = signal(false);
  protected hasFixable = signal(false);
  protected hasUnfixable = signal(false);
  protected activeConfig = signal<string | null>(null);
  private currentRoute = signal('library');

  constructor() {
    this.logoSvg = this.sanitizer.bypassSecurityTrustHtml(LOGO_SVG);
  }

  protected isRoute(prefix: string): boolean {
    return this.currentRoute() === prefix;
  }

  async ngOnInit() {
    if (this.electron.isElectron) {
      await this.refreshHealth();
    }

    this.updateFromUrl(this.router.url);
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.updateFromUrl(e.urlAfterRedirects));
  }

  private updateFromUrl(url: string) {
    const segments = url.split('/').filter(Boolean);
    this.currentRoute.set(segments[0] ?? 'library');

    if ((segments[0] === 'editor' || segments[0] === 'generate') && segments[1]) {
      this.activeConfig.set(decodeURIComponent(segments[1]));
    }
  }

  private async refreshHealth() {
    const h = await this.electron.healthCheck();
    this.health.set(h);
    this.hasFixable.set(!h.ok && h.checks.some((c) => c.status !== 'ok' && c.fixable));
    this.hasUnfixable.set(!h.ok && h.checks.some((c) => c.status !== 'ok' && !c.fixable));
  }

  async fix() {
    this.fixing.set(true);
    await this.electron.healthFix();
    await this.refreshHealth();
    this.fixing.set(false);
  }
}
