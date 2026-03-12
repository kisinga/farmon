import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService, DeviceField, type WorkflowRecord } from '../../core/services/api.service';
import { DeviceContextService } from '../../core/services/device-context.service';
import { ControlsPanelComponent } from '../../shared/components/controls-panel/controls-panel.component';
import { HistoryChartComponent } from '../../shared/components/history-chart/history-chart.component';
import { CurrentValuesComponent } from '../../shared/components/current-values/current-values.component';
import { ErrorBarComponent } from '../../shared/components/error-bar/error-bar.component';
import { OtaSectionComponent } from '../../shared/components/ota-section/ota-section.component';
import { DeviceRulesSectionComponent } from '../../shared/components/device-rules-section/device-rules-section.component';
import { DeviceCredentialsCardComponent } from '../../shared/components/device-credentials-card/device-credentials-card.component';
import { DeviceConfigPanelComponent } from '../../shared/components/device-config-panel/device-config-panel.component';
import { CommandHistoryComponent } from '../../shared/components/command-history/command-history.component';
import { DeviceFramesComponent } from '../../shared/components/device-frames/device-frames.component';
import { ERROR_OBJECT_KEYS } from '../../core/constants/error-fields';
import { getVisibleFieldsByVizType } from '../../core/utils/field-view-model';

@Component({
  selector: 'app-device-detail',
  standalone: true,
  imports: [RouterLink, DatePipe, ControlsPanelComponent, HistoryChartComponent, CurrentValuesComponent, ErrorBarComponent, OtaSectionComponent, DeviceRulesSectionComponent, DeviceCredentialsCardComponent, DeviceConfigPanelComponent, CommandHistoryComponent, DeviceFramesComponent],
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
  activeTab = signal<'overview' | 'controls' | 'telemetry' | 'ota' | 'rules'>('overview');
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

  registrationInfo = computed((): Record<string, unknown> | null => {
    const device = this.deviceContext.device();
    if (!device) return null;
    const raw = (device as unknown as Record<string, unknown>);
    const registeredAt = raw['registered_at'] as string | undefined;
    const schemaVersion = raw['schema_version'] as number | undefined;
    let reg: Record<string, unknown> = {};
    const regRaw = raw['registration'];
    if (typeof regRaw === 'string') {
      try { reg = JSON.parse(regRaw); } catch { /* ignore */ }
    } else if (typeof regRaw === 'object' && regRaw !== null) {
      reg = regRaw as Record<string, unknown>;
    }
    return { registeredAt, schemaVersion, ...reg };
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
