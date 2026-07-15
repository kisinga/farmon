import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { roleGuard } from './core/guards/role.guard';

const ADMIN = { roles: ['admin'] };
const MANAGER = { roles: ['admin', 'partner'] };

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
    // Public features overview.
    path: 'features',
    loadComponent: () =>
      import('./pages/features/features.component').then((m) => m.FeaturesComponent),
  },
  {
    // Public, full-screen cinematic walkthrough of the whole stack.
    path: 'how-it-works',
    loadComponent: () =>
      import('./pages/how-it-works/how-it-works.component').then((m) => m.HowItWorksComponent),
  },
  {
    // Role-aware landing: admins → /overview, customers → their dashboard.
    path: 'home',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/home/home.component').then((m) => m.HomeComponent),
  },
  {
    // Any signed-in user: their own notification preferences.
    path: 'account',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/account/account-page.component').then((m) => m.AccountPageComponent),
  },
  {
    // Admin/partner: sites catalog.
    path: 'overview',
    canActivate: [roleGuard],
    data: MANAGER,
    loadComponent: () =>
      import('./pages/overview/overview.component').then((m) => m.OverviewComponent),
  },
  {
    // Admin/partner: customer accounts (users with role=customer).
    path: 'customers',
    canActivate: [roleGuard],
    data: MANAGER,
    loadComponent: () =>
      import('./pages/customers/customers-page.component').then((m) => m.CustomersPageComponent),
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
    // Admin/partner: registered-device fleet (the provisioning registry).
    path: 'devices',
    canActivate: [roleGuard],
    data: MANAGER,
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
    // Admin: documentation authoring (the `docs` collection).
    path: 'docs',
    canActivate: [roleGuard],
    data: ADMIN,
    loadComponent: () =>
      import('./pages/docs/docs-page.component').then((m) => m.DocsPageComponent),
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
    // Customer + admin: operator automations manager (runtime, not design — edits
    // the automations collection, never the topology).
    path: 'site/:name/automations',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/automations/automations.component').then((m) => m.AutomationsComponent),
  },
  {
    // Admin/partner: the unified workspace (site overview panel + shared canvas).
    path: 'site/:name',
    canActivate: [roleGuard],
    data: MANAGER,
    loadComponent: () =>
      import('./pages/editor/editor.component').then((m) => m.EditorComponent),
  },
  {
    // Admin/partner: per-controller editor — bare path opens the Design canvas.
    path: 'site/:name/system/:config',
    canActivate: [roleGuard],
    data: MANAGER,
    loadComponent: () =>
      import('./pages/editor/editor.component').then((m) => m.EditorComponent),
  },
  {
    // Admin/partner: a specific workspace section (config/schedules/sharing/firmware) —
    // each section is its own bookmarkable URL. Same component; it reads :section.
    path: 'site/:name/system/:config/:section',
    canActivate: [roleGuard],
    data: MANAGER,
    loadComponent: () =>
      import('./pages/editor/editor.component').then((m) => m.EditorComponent),
  },
];
