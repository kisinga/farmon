import { Injectable, signal, inject } from '@angular/core';
import { BackendService } from './backend.service';
import { DEVICE_MODE } from '../tokens/device-mode';

/**
 * Operator-flipped feature switches from the `feature_flags` collection.
 * Loaded once at bootstrap; the route guard (`data: { feature: '...' }`) and
 * nav templates read them to hide unfinished or reversible work without a
 * deploy — flipping a flag is a PocketBase data edit.
 *
 * Fail-open: if the fetch never succeeds (offline, SSR, PB down), every flag
 * reads enabled so a networking hiccup can't take the public site down. Once
 * loaded, an unknown key reads disabled — a flag must exist to light a feature.
 */
@Injectable({ providedIn: 'root' })
export class FeatureFlagsService {
  private readonly backend = inject(BackendService);

  /** key → enabled; null until the first load settles (treated as all-on). */
  private readonly flags = signal<Record<string, boolean> | null>(null);

  /** Resolves when the first load attempt settles (success or failure). */
  readonly ready: Promise<void>;

  constructor() {
    // Device mode: no PocketBase, no flags — skip the fetch entirely (it would
    // 404 against the controller). Fail-open already means all-on.
    this.ready = inject(DEVICE_MODE) ? Promise.resolve() : this.load();
  }

  private async load(): Promise<void> {
    try {
      const rows = await this.backend.pb.collection('feature_flags').getFullList({
        // Bound the wait: the route guard awaits this, so a slow/unreachable PB
        // must not hang first navigation — the catch fails open instead.
        signal: AbortSignal.timeout(5000),
      });
      const map: Record<string, boolean> = {};
      for (const r of rows) map[r['key'] as string] = !!r['enabled'];
      this.flags.set(map);
    } catch {
      // Fail-open: leave flags null.
    }
  }

  isEnabled(key: string): boolean {
    const f = this.flags();
    if (f === null) return true;
    return f[key] ?? false;
  }
}
