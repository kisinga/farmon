import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterOutlet, RouterLink, Router, NavigationEnd } from '@angular/router';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { ElectronService } from './core/services/electron.service';
import type { HealthReport, SeedChange } from './core/models/electron-api';
import { filter } from 'rxjs';

const LOGO_SVG = `<svg viewBox="-90 -90 180 180" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="width:100%;height:100%;display:block">
  <defs>
    <linearGradient id="sr1" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#22D3EE"/><stop offset="100%" stop-color="#0369A1"/></linearGradient>
    <linearGradient id="sr2" x1="1" y1="0.5" x2="0" y2="1"><stop offset="0%" stop-color="#38BDF8"/><stop offset="100%" stop-color="#0369A1"/></linearGradient>
    <linearGradient id="sr3" x1="0" y1="1" x2="0.5" y2="0"><stop offset="0%" stop-color="#06B6D4"/><stop offset="100%" stop-color="#0284C7"/></linearGradient>
  </defs>
  <g transform="rotate(-30)">
    <path d="M-78,0 C-55,-10 -28,10 -10,0 C-2,-3 2,0 5,0" fill="none" stroke="url(#sr1)" stroke-width="3" stroke-linecap="round" opacity="0.45"/>
    <path d="M-74,9 C-50,-1 -26,18 -8,9 C2,4 5,8 7,6" fill="none" stroke="url(#sr1)" stroke-width="5" stroke-linecap="round" opacity="0.65"/>
    <path d="M-70,20 C-48,10 -22,28 -4,20 C6,16 8,20 10,16" fill="none" stroke="url(#sr1)" stroke-width="8" stroke-linecap="round" opacity="0.85"/>
  </g>
  <g transform="rotate(90)">
    <path d="M-78,0 C-55,-10 -28,10 -10,0 C-2,-3 2,0 5,0" fill="none" stroke="url(#sr2)" stroke-width="3" stroke-linecap="round" opacity="0.45"/>
    <path d="M-74,9 C-50,-1 -26,18 -8,9 C2,4 5,8 7,6" fill="none" stroke="url(#sr2)" stroke-width="5" stroke-linecap="round" opacity="0.65"/>
    <path d="M-70,20 C-48,10 -22,28 -4,20 C6,16 8,20 10,16" fill="none" stroke="url(#sr2)" stroke-width="8" stroke-linecap="round" opacity="0.85"/>
  </g>
  <g transform="rotate(210)">
    <path d="M-78,0 C-55,-10 -28,10 -10,0 C-2,-3 2,0 5,0" fill="none" stroke="url(#sr3)" stroke-width="3" stroke-linecap="round" opacity="0.45"/>
    <path d="M-74,9 C-50,-1 -26,18 -8,9 C2,4 5,8 7,6" fill="none" stroke="url(#sr3)" stroke-width="5" stroke-linecap="round" opacity="0.65"/>
    <path d="M-70,20 C-48,10 -22,28 -4,20 C6,16 8,20 10,16" fill="none" stroke="url(#sr3)" stroke-width="8" stroke-linecap="round" opacity="0.85"/>
  </g>
  <circle cx="0" cy="0" r="8" fill="#0C4A6E"/>
  <circle cx="0" cy="0" r="4.5" fill="#0EA5E9"/>
  <circle cx="0" cy="0" r="2" fill="#E0F2FE"/>
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
  protected seedChanges = signal<SeedChange[]>([]);
  protected applyingSeed = signal(false);
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
      const changes = await this.electron.seedChanges();
      if (changes.length > 0) this.seedChanges.set(changes);
    }

    this.updateFromUrl(this.router.url);
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.updateFromUrl(e.urlAfterRedirects));
  }

  private updateFromUrl(url: string) {
    const segments = url.split('/').filter(Boolean);
    this.currentRoute.set(segments[0] ?? 'library');

    if (segments[0] === 'editor' && segments[1]) {
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

  async applyAllSeedChanges() {
    this.applyingSeed.set(true);
    await this.electron.applySeed();
    this.seedChanges.set([]);
    this.applyingSeed.set(false);
  }

  async dismissSeedChange(id: string) {
    await this.electron.dismissSeed(id);
    this.seedChanges.update((list) => list.filter((c) => c.id !== id));
  }
}
