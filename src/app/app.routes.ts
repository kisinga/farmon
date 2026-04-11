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
    path: 'site/:name/system/:config',
    loadComponent: () =>
      import('./pages/editor/editor.component').then((m) => m.EditorComponent),
    children: [
      { path: '', redirectTo: 'device', pathMatch: 'full' },
      {
        path: 'device',
        loadComponent: () =>
          import('./pages/editor/device-tab/device-tab.component').then((m) => m.DeviceTabComponent),
      },
      {
        // Design tab is always-mounted in the editor template to preserve X6 canvas state.
        // This empty route exists solely so the router doesn't throw NG04002 when navigating to /design.
        path: 'design',
        children: [],
      },
      {
        path: 'automations',
        loadComponent: () =>
          import('./pages/editor/automations-tab/automations-tab.component').then((m) => m.AutomationsTabComponent),
      },
      {
        path: 'timing',
        loadComponent: () =>
          import('./pages/editor/timing-tab/timing-tab.component').then((m) => m.TimingTabComponent),
      },
      {
        path: 'deploy',
        loadComponent: () =>
          import('./pages/editor/deploy-tab/deploy-tab.component').then((m) => m.DeployTabComponent),
      },
      {
        path: 'docs',
        loadComponent: () =>
          import('./pages/editor/docs-tab/docs-tab.component').then((m) => m.DocsTabComponent),
      },
    ],
  },
];
