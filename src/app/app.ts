import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router, NavigationEnd } from '@angular/router';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { AuthStore } from './core/services/auth.store';
import { RealtimeService } from './core/services/realtime.service';
import { ConfirmDialogComponent } from './shared/confirm-dialog/confirm-dialog.component';
import { AlertsCenterComponent } from './shared/alerts-center.component';
import { BRAND_LOGO_SVG } from './shared/brand-logo';
import { filter } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ConfirmDialogComponent, AlertsCenterComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  protected auth = inject(AuthStore);
  private router = inject(Router);
  private sanitizer = inject(DomSanitizer);
  private swUpdate = inject(SwUpdate);
  private realtime = inject(RealtimeService);

  /** Live SSE stream state — drives the global "Reconnecting…" banner. */
  protected connection = this.realtime.connection;

  protected logoSvg: SafeHtml;
  private currentUrl = signal('/overview');

  // Set once the service worker has fetched a new app version and is ready to
  // activate it. Surfaces a "Reload" toast; the new build only takes over after
  // a full reload, so we let the user pick the moment.
  protected updateReady = signal(false);

  // Public, full-bleed pages (landing + login + pricing) bring their own branded
  // layout, so the app shell hides its top bar there.
  protected isPublic = computed(() => {
    const url = this.currentUrl().split(/[?#]/, 1)[0];
    return url === '/' || url === '' || url.startsWith('/login') || url.startsWith('/pricing') || url.startsWith('/features') || url.startsWith('/how-it-works');
  });

  constructor() {
    this.logoSvg = this.sanitizer.bypassSecurityTrustHtml(BRAND_LOGO_SVG);

    // Disabled in dev and where the SW is unsupported — guard so nothing fires.
    if (this.swUpdate.isEnabled) {
      this.swUpdate.versionUpdates
        .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
        .subscribe(() => this.updateReady.set(true));
    }
  }

  ngOnInit() {
    this.currentUrl.set(this.router.url);
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.currentUrl.set(e.urlAfterRedirects));
  }

  protected reloadApp(): void {
    document.location.reload();
  }

  protected logout(): void {
    this.auth.logout();
    void this.router.navigate(['/login']);
  }
}
