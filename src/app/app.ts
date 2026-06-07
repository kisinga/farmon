import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router, NavigationEnd } from '@angular/router';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { AuthStore } from './core/services/auth.store';
import { ConfirmDialogComponent } from './shared/confirm-dialog/confirm-dialog.component';
import { BRAND_LOGO_SVG } from './shared/brand-logo';
import { filter } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ConfirmDialogComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  protected auth = inject(AuthStore);
  private router = inject(Router);
  private sanitizer = inject(DomSanitizer);

  protected logoSvg: SafeHtml;
  private currentUrl = signal('/overview');

  // Public, full-bleed pages (landing + login + pricing) bring their own branded
  // layout, so the app shell hides its top bar there.
  protected isPublic = computed(() => {
    const url = this.currentUrl();
    return url === '/' || url === '' || url.startsWith('/login') || url.startsWith('/pricing');
  });

  constructor() {
    this.logoSvg = this.sanitizer.bypassSecurityTrustHtml(BRAND_LOGO_SVG);
  }

  ngOnInit() {
    this.currentUrl.set(this.router.url);
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.currentUrl.set(e.urlAfterRedirects));
  }

  protected logout(): void {
    this.auth.logout();
    void this.router.navigate(['/login']);
  }
}
