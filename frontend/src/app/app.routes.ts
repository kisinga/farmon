import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/device-list/device-list.component').then(m => m.DeviceListComponent) },
  { path: 'device/:eui', loadComponent: () => import('./pages/device-detail/device-detail.component').then(m => m.DeviceDetailComponent) },
  { path: 'profiles', loadComponent: () => import('./pages/profiles/profile-list.component').then(m => m.ProfileListComponent) },
  { path: 'profiles/:id', loadComponent: () => import('./pages/profiles/profile-detail.component').then(m => m.ProfileDetailComponent) },
  { path: 'workflows', loadComponent: () => import('./pages/workflows/workflows.component').then(m => m.WorkflowsComponent) },
  { path: 'workflows/new', loadComponent: () => import('./pages/workflows/workflow-editor.component').then(m => m.WorkflowEditorComponent) },
  { path: 'workflows/:id/edit', loadComponent: () => import('./pages/workflows/workflow-editor.component').then(m => m.WorkflowEditorComponent) },
  { path: 'network', loadComponent: () => import('./pages/lorawan-monitor/lorawan-monitor.component').then(m => m.LorawanMonitorComponent) },
  { path: 'settings', loadComponent: () => import('./pages/settings/settings.component').then(m => m.SettingsComponent) },
  { path: 'lorawan', redirectTo: 'network' },
  { path: 'firmware-commands', redirectTo: 'settings' },
  { path: '**', redirectTo: '' },
];
