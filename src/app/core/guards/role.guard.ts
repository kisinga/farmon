import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { BackendService } from '../services/backend.service';

/**
 * Restricts a route to users whose `role` is in the route's `data.roles`.
 * Unauthenticated → /login; authenticated-but-wrong-role → /home, which routes
 * each role where it belongs (admins to /overview, customers to their
 * dashboard). Must NOT fall back to an admin route, or a customer would loop.
 *
 * Usage: `{ path: 'admin', canActivate: [roleGuard], data: { roles: ['admin'] } }`
 */
export const roleGuard: CanActivateFn = (route) => {
  const backend = inject(BackendService);
  const router = inject(Router);

  if (!backend.pb.authStore.isValid) {
    return router.createUrlTree(['/login']);
  }

  const allowed = (route.data?.['roles'] as string[] | undefined) ?? [];
  const role = backend.pb.authStore.record?.['role'] as string | undefined;
  if (allowed.length === 0 || (role && allowed.includes(role))) return true;

  return router.createUrlTree(['/home']);
};
