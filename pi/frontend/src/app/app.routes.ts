import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/device-list/device-list.component').then(m => m.DeviceListComponent) },
  { path: 'device/:eui', loadComponent: () => import('./pages/device-detail/device-detail.component').then(m => m.DeviceDetailComponent) },
  { path: '**', redirectTo: '' },
];
