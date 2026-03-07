import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DeviceContextService } from '../../core/services/device-context.service';
import { ControlsPanelComponent } from '../../shared/components/controls-panel/controls-panel.component';
import { HistoryChartComponent } from '../../shared/components/history-chart/history-chart.component';
import { CurrentValuesComponent } from '../../shared/components/current-values/current-values.component';
import { ErrorBarComponent } from '../../shared/components/error-bar/error-bar.component';
import { OtaSectionComponent } from '../../shared/components/ota-section/ota-section.component';
import { EdgeRulesSectionComponent } from '../../shared/components/edge-rules-section/edge-rules-section.component';
import { ERROR_OBJECT_KEYS } from '../../core/constants/error-fields';

@Component({
  selector: 'app-device-detail',
  standalone: true,
  imports: [RouterLink, DatePipe, ControlsPanelComponent, HistoryChartComponent, CurrentValuesComponent, ErrorBarComponent, OtaSectionComponent, EdgeRulesSectionComponent],
  templateUrl: './device-detail.component.html',
})
export class DeviceDetailComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  deviceContext = inject(DeviceContextService);
  routeError = signal<string | null>(null);
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
  }

  ngOnDestroy(): void {
    this.deviceContext.clear();
  }
}
