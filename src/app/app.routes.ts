import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { roleGuard } from './core/guards/role.guard';

const ADMIN = { roles: ['admin'] };

export const routes: Routes = [
  {
    // Public landing + tiers. Everything below is auth-guarded.
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./pages/landing/landing.component').then((m) => m.LandingComponent),
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./pages/login/login.component').then((m) => m.LoginComponent),
  },
  {
    // Public pricing estimator + consent-gated lead capture.
    path: 'pricing',
    loadComponent: () =>
      import('./pages/pricing/pricing.component').then((m) => m.PricingComponent),
  },
  {
    // Role-aware landing: admins → /overview, customers → their dashboard.
    path: 'home',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/home/home.component').then((m) => m.HomeComponent),
  },
  {
    // Admin: sites catalog.
    path: 'overview',
    canActivate: [roleGuard],
    data: ADMIN,
    loadComponent: () =>
      import('./pages/overview/overview.component').then((m) => m.OverviewComponent),
  },
  {
    // Admin: board catalog.
    path: 'boards',
    canActivate: [roleGuard],
    data: ADMIN,
    loadComponent: () =>
      import('./pages/boards/boards-page.component').then((m) => m.BoardsPageComponent),
  },
  {
    // Admin: registered-device fleet (the provisioning registry).
    path: 'devices',
    canActivate: [roleGuard],
    data: ADMIN,
    loadComponent: () =>
      import('./pages/devices/devices-page.component').then((m) => m.DevicesPageComponent),
  },
  {
    // Admin: captured pricing-estimator leads.
    path: 'leads',
    canActivate: [roleGuard],
    data: ADMIN,
    loadComponent: () =>
      import('./pages/leads/leads-page.component').then((m) => m.LeadsPageComponent),
  },
  {
    // Admin: global platform settings (app_config).
    path: 'settings',
    canActivate: [roleGuard],
    data: ADMIN,
    loadComponent: () =>
      import('./pages/settings/settings-page.component').then((m) => m.SettingsPageComponent),
  },
  {
    // Customer + admin: the site dashboard (separate component — runtime state
    // only, no editor services). Declared before the editor's `site/:name` so
    // the more specific path wins.
    path: 'site/:name/dashboard',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/dashboard/dashboard.component').then((m) => m.DashboardComponent),
  },
  {
    // Admin: the unified workspace (site overview panel + shared canvas).
    path: 'site/:name',
    canActivate: [roleGuard],
    data: ADMIN,
    loadComponent: () =>
      import('./pages/editor/editor.component').then((m) => m.EditorComponent),
  },
  {
    // Admin: per-controller editor — bare path opens the Design canvas.
    path: 'site/:name/system/:config',
    canActivate: [roleGuard],
    data: ADMIN,
    loadComponent: () =>
      import('./pages/editor/editor.component').then((m) => m.EditorComponent),
  },
  {
    // Admin: a specific workspace section (config/schedules/sharing/firmware) —
    // each section is its own bookmarkable URL. Same component; it reads :section.
    path: 'site/:name/system/:config/:section',
    canActivate: [roleGuard],
    data: ADMIN,
    loadComponent: () =>
      import('./pages/editor/editor.component').then((m) => m.EditorComponent),
  },
];
