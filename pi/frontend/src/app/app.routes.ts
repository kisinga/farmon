import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/device-list/device-list.component').then(m => m.DeviceListComponent) },
  { path: 'device/:eui', loadComponent: () => import('./pages/device-detail/device-detail.component').then(m => m.DeviceDetailComponent) },
  { path: 'workflows', loadComponent: () => import('./pages/workflows/workflows.component').then(m => m.WorkflowsComponent) },
  { path: 'lorawan', loadComponent: () => import('./pages/lorawan-monitor/lorawan-monitor.component').then(m => m.LorawanMonitorComponent) },
  { path: '**', redirectTo: '' },
];
