import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { FeatureFlagsService } from '../services/feature-flags.service';

/**
 * Restricts a route to an enabled feature flag. Off → the public landing (a
 * gated page should look absent, not broken). Awaits the first flags load so a
 * deep link doesn't race the bootstrap fetch.
 *
 * Usage: `{ path: 'pricing', canActivate: [featureGuard], data: { feature: 'pricing_page' } }`
 */
export const featureGuard: CanActivateFn = async (route) => {
  const flags = inject(FeatureFlagsService);
  const router = inject(Router);

  const key = route.data?.['feature'] as string | undefined;
  if (!key) return true;
  await flags.ready;
  if (flags.isEnabled(key)) return true;
  return router.createUrlTree(['/']);
};
