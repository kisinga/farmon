import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/device-list/device-list.component').then(m => m.DeviceListComponent) },
  { path: 'device/:eui', loadComponent: () => import('./pages/device-detail/device-detail.component').then(m => m.DeviceDetailComponent) },
  { path: 'lorawan', loadComponent: () => import('./pages/lorawan-monitor/lorawan-monitor.component').then(m => m.LorawanMonitorComponent) },
  { path: 'settings', loadComponent: () => import('./pages/gateway-settings/gateway-settings.component').then(m => m.GatewaySettingsComponent) },
  { path: '**', redirectTo: '' },
];
