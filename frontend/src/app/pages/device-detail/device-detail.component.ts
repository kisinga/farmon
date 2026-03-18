import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { DatePipe, NgClass } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService, DeviceField, type WorkflowRecord } from '../../core/services/api.service';
import { DeviceContextService } from '../../core/services/device-context.service';
import { ControlsPanelComponent } from '../../shared/components/controls-panel/controls-panel.component';
import { HistoryChartComponent } from '../../shared/components/history-chart/history-chart.component';
import { CurrentValuesComponent } from '../../shared/components/current-values/current-values.component';
import { ErrorBarComponent } from '../../shared/components/error-bar/error-bar.component';
import { DeviceRulesSectionComponent } from '../../shared/components/device-rules-section/device-rules-section.component';
import { DeviceCredentialsCardComponent } from '../../shared/components/device-credentials-card/device-credentials-card.component';
import { DeviceConfigPanelComponent } from '../../shared/components/device-config-panel/device-config-panel.component';
import { CommandHistoryComponent } from '../../shared/components/command-history/command-history.component';
import { DeviceFramesComponent } from '../../shared/components/device-frames/device-frames.component';
import { DeviceSensorConfigComponent } from '../../shared/components/device-sensor-config/device-sensor-config.component';
import { ERROR_OBJECT_KEYS } from '../../core/constants/error-fields';
import { getVisibleFieldsByVizType } from '../../core/utils/field-view-model';
import type { DeviceRuleRecord } from '../../core/services/api.service';

@Component({
  selector: 'app-device-detail',
  standalone: true,
  imports: [RouterLink, DatePipe, NgClass, ControlsPanelComponent, HistoryChartComponent, CurrentValuesComponent, ErrorBarComponent, DeviceRulesSectionComponent, DeviceCredentialsCardComponent, DeviceConfigPanelComponent, CommandHistoryComponent, DeviceFramesComponent, DeviceSensorConfigComponent],
  templateUrl: './device-detail.component.html',
})
export class DeviceDetailComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private api = inject(ApiService);
  deviceContext = inject(DeviceContextService);
  routeError = signal<string | null>(null);
  deleting = signal(false);
  relatedWorkflows = signal<WorkflowRecord[]>([]);
  activeTab = signal<'overview' | 'controls' | 'telemetry' | 'rules' | 'sensors'>('overview');
  prefillRuleForm = signal<Partial<DeviceRuleRecord> | null>(null);
  timeRange = signal<'1h' | '24h' | '7d'>('24h');
  rangeEnd = signal<string>(new Date().toISOString());

  historyFrom = computed(() => {
    const toStr = this.rangeEnd();
    const range = this.timeRange();
    const to = new Date(toStr);
    const d = new Date(to);
    if (range === '1h') d.setHours(d.getHours() - 1);
    else if (range === '24h') d.setDate(d.getDate() - 1);
    else if (range === '7d') d.setDate(d.getDate() - 7);
    return d.toISOString();
  });
  historyTo = computed(() => this.rangeEnd());

  onTimeRangeChange(e: Event): void {
    const v = (e.target as HTMLSelectElement).value as '1h' | '24h' | '7d';
    if (v === '1h' || v === '24h' || v === '7d') {
      this.timeRange.set(v);
      this.rangeEnd.set(new Date().toISOString());
    }
  }

  onPrefillRule(r: Partial<DeviceRuleRecord>): void {
    this.prefillRuleForm.set(r);
    this.activeTab.set('rules');
  }

  chartFields = computed(() => {
    const fields = this.deviceContext.fieldConfigs();
    return getVisibleFieldsByVizType(fields, { chart: true }).chart;
  });

  telemetryFields = computed(() =>
    this.deviceContext.fieldConfigs().filter((f: DeviceField) => f.category === 'telemetry')
  );

  systemFields = computed(() =>
    this.deviceContext.fieldConfigs().filter((f: DeviceField) => f.category === 'system')
  );

  /** Transfer FSM state from latest telemetry (0=idle, 1=measuring, 2=pumping). */
  transferState = computed(() => {
    const t = this.deviceContext.latestTelemetry();
    const fields = this.deviceContext.fieldConfigs();
    if (!t || !fields.some(f => f.field_key === 'transfer_state')) return null;
    const v = (t as Record<string, unknown>)['transfer_state'];
    return typeof v === 'number' ? v : null;
  });

  transferStateLabel = computed(() => {
    switch (this.transferState()) {
      case 0: return 'Idle';
      case 1: return 'Measuring';
      case 2: return 'Pumping';
      default: return null;
    }
  });

  transferStateBadge = computed(() => {
    switch (this.transferState()) {
      case 0: return 'badge-ghost';
      case 1: return 'badge-warning';
      case 2: return 'badge-success';
      default: return 'badge-ghost';
    }
  });

  stoppingTransfer = signal(false);

  stopTransfer(): void {
    const eui = this.deviceContext.eui();
    if (!eui) return;
    this.stoppingTransfer.set(true);
    this.api.setControl(eui, 'pump', 'off', 3600).subscribe({
      next: () => this.stoppingTransfer.set(false),
      error: () => this.stoppingTransfer.set(false),
    });
  }

  profileInfo = computed(() => {
    const profile = this.deviceContext.profile();
    const device = this.deviceContext.device();
    if (!profile) return null;
    return {
      name: profile.name,
      type: profile.profile_type,
      fieldCount: profile.fields?.length ?? 0,
      controlCount: profile.controls?.length ?? 0,
      commandCount: profile.commands?.length ?? 0,
      configStatus: device?.config_status ?? 'n/a',
    };
  });

  errorObjectFromTelemetry = computed(() => {
    const data = this.deviceContext.latestTelemetry();
    if (!data || typeof data !== 'object') return {};
    const out: Record<string, number> = {};
    for (const k of ERROR_OBJECT_KEYS) {
      const v = (data as Record<string, unknown>)[k];
      if (typeof v === 'number') out[k] = v;
    }
    return out;
  });

  ngOnInit(): void {
    const eui = this.route.snapshot.paramMap.get('eui');
    if (!eui) {
      this.routeError.set('Missing device EUI');
      this.deviceContext.clear();
      return;
    }
    this.routeError.set(null);
    this.deviceContext.load(eui);
    this.api.getWorkflows(eui).subscribe({
      next: (list) => this.relatedWorkflows.set(list),
      error: () => this.relatedWorkflows.set([]),
    });
  }

  ngOnDestroy(): void {
    this.deviceContext.clear();
  }

  confirmDeleteDevice(): void {
    const eui = this.deviceContext.eui();
    const name = this.deviceContext.device()?.device_name || eui;
    if (!eui || !confirm(`Delete device "${name}" (${eui})? This cannot be undone. You can re-register it later.`)) {
      return;
    }
    this.deleting.set(true);
    this.api.deleteDevice(eui).subscribe({
      next: () => this.router.navigate(['/']),
      error: () => this.deleting.set(false),
    });
  }
}
