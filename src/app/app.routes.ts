import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

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
    path: 'overview',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/overview/overview.component').then((m) => m.OverviewComponent),
  },
  {
    path: 'boards',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/boards/boards-page.component').then((m) => m.BoardsPageComponent),
  },
  {
    // Bare site → the unified workspace (site overview panel + shared canvas).
    path: 'site/:name',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/editor/editor.component').then((m) => m.EditorComponent),
  },
  {
    path: 'site/:name/system/:config',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/editor/editor.component').then((m) => m.EditorComponent),
  },
];
