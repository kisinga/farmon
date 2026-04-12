import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'overview',
    pathMatch: 'full',
  },
  {
    path: 'overview',
    loadComponent: () =>
      import('./pages/overview/overview.component').then((m) => m.OverviewComponent),
  },
  {
    path: 'site/:name',
    loadComponent: () =>
      import('./pages/site/site-view.component').then((m) => m.SiteViewComponent),
  },
  {
    path: 'site/:name/deploy',
    loadComponent: () =>
      import('./pages/deploy/deploy-page.component').then((m) => m.DeployPageComponent),
  },
  {
    path: 'site/:name/system/:config',
    loadComponent: () =>
      import('./pages/editor/editor.component').then((m) => m.EditorComponent),
    children: [
      { path: '', redirectTo: 'design', pathMatch: 'full' },
      {
        // Design tab is always-mounted in the editor template to preserve X6 canvas state.
        // This empty route exists solely so the router doesn't throw NG04002 when navigating to /design.
        path: 'design',
        children: [],
      },
      {
        path: 'config',
        loadComponent: () =>
          import('./pages/editor/config-tab/config-tab.component').then((m) => m.ConfigTabComponent),
      },
      {
        path: 'automations',
        loadComponent: () =>
          import('./pages/editor/automations-tab/automations-tab.component').then((m) => m.AutomationsTabComponent),
      },
    ],
  },
];
