import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { GatewayStatusIndicatorComponent } from '../gateway-status-indicator/gateway-status-indicator.component';
import { LogoComponent } from '../logo/logo.component';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, GatewayStatusIndicatorComponent, LogoComponent],
  template: `
    <header class="navbar bg-base-100 border-b border-base-300 px-4 md:px-6 sticky top-0 z-30 shadow-sm">
      <div class="navbar-start">
        <a routerLink="/" class="btn btn-ghost gap-2 px-2 text-lg font-semibold" aria-label="FarMon home">
          <app-logo />
          <span class="brand-far">Far</span><span class="brand-mon">Mon</span>
        </a>
      </div>
      <div class="navbar-center hidden md:flex">
        <ul class="menu menu-horizontal menu-lg gap-1 p-0">
          @for (link of navLinks; track link.path) {
            <li>
              <a [routerLink]="link.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: !!link.exact }" class="rounded-lg">
                {{ link.label }}
              </a>
            </li>
          }
        </ul>
      </div>
      <div class="navbar-end gap-2">
        <app-gateway-status-indicator />
        <!-- Mobile menu -->
        <div class="dropdown dropdown-end md:hidden">
          <label tabindex="0" class="btn btn-ghost btn-square">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </label>
          <ul tabindex="0" class="menu dropdown-content bg-base-100 rounded-box z-40 mt-3 w-52 border border-base-300 p-2 shadow-xl">
            @for (link of navLinks; track link.path) {
              <li><a [routerLink]="link.path" (click)="closeDropdown($event)">{{ link.label }}</a></li>
            }
          </ul>
        </div>
      </div>
    </header>
  `,
})
export class NavbarComponent {
  readonly navLinks = [
    { path: '/', label: 'Devices', exact: true },
    { path: '/templates', label: 'Templates' },
    { path: '/workflows', label: 'Workflows' },
    { path: '/network', label: 'Network' },
    { path: '/settings', label: 'Settings' },
  ];

  closeDropdown(_e: Event): void {
    (document.activeElement as HTMLElement)?.blur();
  }
}
