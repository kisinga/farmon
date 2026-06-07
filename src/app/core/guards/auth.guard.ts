import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { BackendService } from '../services/backend.service';

/** Allows activation only when a valid PocketBase auth session exists. */
export const authGuard: CanActivateFn = () => {
  const backend = inject(BackendService);
  const router = inject(Router);

  if (backend.pb.authStore.isValid) return true;
  return router.createUrlTree(['/login']);
};
