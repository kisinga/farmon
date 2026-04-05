import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'library',
    pathMatch: 'full',
  },
  {
    path: 'library',
    loadComponent: () =>
      import('./pages/library/library.component').then((m) => m.LibraryComponent),
  },
  {
    path: 'editor/:name',
    loadComponent: () =>
      import('./pages/editor/editor.component').then((m) => m.EditorComponent),
  },
];
