import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { RouterOutlet, RouterLink, Router, NavigationEnd } from '@angular/router';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { ElectronService } from './core/services/electron.service';
import { WorkspaceService } from './core/services/workspace.service';
import { SystemEditorService } from './core/services/system-editor.service';
import { ContextStripComponent } from './shared/context-strip/context-strip.component';
import { PipelineRailComponent } from './shared/pipeline-rail/pipeline-rail.component';
import { SiteRailComponent } from './shared/site-rail/site-rail.component';
import { ConfirmDialogComponent } from './shared/confirm-dialog/confirm-dialog.component';
import type { SeedChange } from './core/models/electron-api';
import { filter } from 'rxjs';

const LOGO_SVG = `<svg viewBox="-90 -90 180 180" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block">
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
  imports: [RouterOutlet, RouterLink, ContextStripComponent, PipelineRailComponent, SiteRailComponent, ConfirmDialogComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  private electron = inject(ElectronService);
  private workspace = inject(WorkspaceService);
  private systemEditor = inject(SystemEditorService);
  private router = inject(Router);
  private sanitizer = inject(DomSanitizer);

  protected logoSvg: SafeHtml;
  protected seedChanges = signal<SeedChange[]>([]);
  protected applyingSeed = signal(false);
  private currentUrl = signal('/overview');

  protected navLevel = computed<'overview' | 'site' | 'editor'>(() => {
    const url = this.currentUrl();
    if (/^\/site\/[^/]+\/system\//.test(url)) return 'editor';
    if (url.startsWith('/site/')) return 'site';
    return 'overview';
  });

  protected backLink = computed(() => {
    const segments = this.currentUrl().split('/').filter(Boolean);

    if (segments[0] === 'site' && segments[1] && segments[2] === 'system') {
      const siteSlug = decodeURIComponent(segments[1]);
      const siteFriendly = this.workspace.site()?.friendlyName ?? siteSlug;
      return { label: siteFriendly, link: `/site/${segments[1]}`, colorClass: 'nav-label-site' };
    }
    if (segments[0] === 'site' && segments[1] && segments[2] === 'deploy') {
      const siteSlug = decodeURIComponent(segments[1]);
      const siteFriendly = this.workspace.site()?.friendlyName ?? siteSlug;
      return { label: siteFriendly, link: `/site/${segments[1]}`, colorClass: 'nav-label-site' };
    }
    if (segments[0] === 'site' && segments[1]) {
      return { label: 'Overview', link: '/overview', colorClass: 'nav-label-overview' };
    }
    return null;
  });

  constructor() {
    this.logoSvg = this.sanitizer.bypassSecurityTrustHtml(LOGO_SVG);
  }

  async ngOnInit() {
    this.currentUrl.set(this.router.url);
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.currentUrl.set(e.urlAfterRedirects));

    if (this.electron.isElectron) {
      const changes = await this.electron.seedChanges();
      if (changes.length > 0) this.seedChanges.set(changes);
    }
  }

  protected async onEditorSave() {
    await this.workspace.save();
  }

  protected async applyAllSeedChanges() {
    this.applyingSeed.set(true);
    await this.electron.applySeed();
    this.seedChanges.set([]);
    this.applyingSeed.set(false);
  }

  protected async dismissSeedChange(id: string) {
    await this.electron.dismissSeed(id);
    this.seedChanges.update(list => list.filter(c => c.id !== id));
  }

  protected async dismissAllSeedChanges() {
    for (const c of this.seedChanges()) {
      await this.electron.dismissSeed(c.id);
    }
    this.seedChanges.set([]);
  }
}
