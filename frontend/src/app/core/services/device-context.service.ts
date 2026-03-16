import { Injectable, inject, signal, computed } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { ApiService, Device, DeviceControl, DeviceField, DeviceProfile, ProfileCommand } from './api.service';
import { PocketBaseService } from './pocketbase.service';
import { TelemetrySubscriptionService } from './telemetry-subscription.service';

@Injectable({ providedIn: 'root' })
export class DeviceContextService {
  private api = inject(ApiService);
  private pbService = inject(PocketBaseService);
  private telemetrySubscription = inject(TelemetrySubscriptionService);

  private _device = signal<Device | null>(null);
  private _controls = signal<DeviceControl[]>([]);
  private _fieldConfigs = signal<DeviceField[]>([]);
  private _latestTelemetry = signal<Record<string, unknown> | null>(null);
  private _profile = signal<DeviceProfile | null>(null);
  private _loading = signal(false);
  private _error = signal<string | null>(null);
  private _eui = signal<string>('');

  private telemetrySub: Subscription | null = null;
  private controlsUnsub: (() => Promise<void>) | null = null;
  private fieldsUnsub: (() => Promise<void>) | null = null;

  device = this._device.asReadonly();
  controls = this._controls.asReadonly();
  fieldConfigs = this._fieldConfigs.asReadonly();
  latestTelemetry = this._latestTelemetry.asReadonly();
  profile = this._profile.asReadonly();
  loading = this._loading.asReadonly();
  error = this._error.asReadonly();
  eui = this._eui.asReadonly();

  controlsMap = computed(() => {
    const list = this._controls();
    const map = new Map<string, DeviceControl>();
    for (const c of list) {
      map.set(c.control_key, c);
    }
    return map;
  });

  /** Profile commands for this device (from profile, not device). */
  profileCommands = computed<ProfileCommand[]>(() => this._profile()?.commands ?? []);

  /** Whether the device's profile is airconfig type. */
  isAirConfig = computed(() => this._profile()?.profile_type === 'airconfig');

  load(eui: string): void {
    if (!eui) {
      this.clear();
      return;
    }
    this.unsubscribeAll();
    this._eui.set(eui);
    this._loading.set(true);
    this._error.set(null);

    forkJoin({
      device: this.api.getDeviceConfig(eui),
      controls: this.api.getDeviceControls(eui),
      fields: this.api.getDeviceFields(eui),
      latest: this.api.getLatestTelemetry(eui).pipe(catchError(() => of(null))),
    }).pipe(
      switchMap(({ device, controls, fields, latest }) => {
        this._device.set(device);
        this._controls.set(controls);
        this._fieldConfigs.set(fields);
        this._latestTelemetry.set(latest?.data ?? null);

        // Load profile if device has one
        if (device.profile) {
          return this.api.getProfile(device.profile).pipe(
            catchError(() => of(null))
          );
        }
        return of(null);
      })
    ).subscribe({
      next: (profile) => {
        this._profile.set(profile);
        this._loading.set(false);

        const eui = this._eui();
        // Realtime telemetry subscription
        this.telemetrySub = this.telemetrySubscription.stream(eui).subscribe((payload) => {
          this._latestTelemetry.set(payload.data ?? null);
        });

        // Realtime controls subscription
        const controlFilter = this.pbService.pb.filter('device_eui = {:eui}', { eui });
        this.pbService.pb.collection('device_controls').subscribe('*', (event) => {
          if (event.action === 'create' || event.action === 'update') {
            const updated = event.record as unknown as DeviceControl;
            this._controls.update(list => {
              const idx = list.findIndex(c => c.control_key === updated.control_key);
              if (idx >= 0) {
                const copy = [...list];
                copy[idx] = updated;
                return copy;
              }
              return [...list, updated];
            });
          }
        }, { filter: controlFilter }).then(unsub => {
          this.controlsUnsub = unsub;
        });

        // Realtime fields subscription
        const fieldFilter = this.pbService.pb.filter('device_eui = {:eui}', { eui });
        this.pbService.pb.collection('device_fields').subscribe('*', (event) => {
          if (event.action === 'create' || event.action === 'update') {
            const updated = event.record as unknown as DeviceField;
            this._fieldConfigs.update(list => {
              const idx = list.findIndex(f => f.field_key === updated.field_key);
              if (idx >= 0) {
                const copy = [...list];
                copy[idx] = updated;
                return copy;
              }
              return [...list, updated];
            });
          }
        }, { filter: fieldFilter }).then(unsub => {
          this.fieldsUnsub = unsub;
        });
      },
      error: (err) => {
        this._error.set(err?.message ?? 'Failed to load device');
        this._loading.set(false);
      },
    });
  }

  private unsubscribeAll(): void {
    this.telemetrySub?.unsubscribe();
    this.telemetrySub = null;
    this.controlsUnsub?.();
    this.controlsUnsub = null;
    this.fieldsUnsub?.();
    this.fieldsUnsub = null;
  }

  clear(): void {
    this.unsubscribeAll();
    this._eui.set('');
    this._device.set(null);
    this._controls.set([]);
    this._fieldConfigs.set([]);
    this._latestTelemetry.set(null);
    this._profile.set(null);
    this._loading.set(false);
    this._error.set(null);
  }
}
