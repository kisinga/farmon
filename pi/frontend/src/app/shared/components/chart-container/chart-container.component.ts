import { Component, input, computed } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';

export interface ChartSeriesInput {
  name: string;
  data: Array<{ ts: string; value: number }>;
}

@Component({
  selector: 'app-chart-container',
  standalone: true,
  imports: [NgxEchartsDirective],
  template: `
    <div class="rounded-xl border border-base-200 bg-base-100 p-4 shadow-sm" [style.height.px]="height()">
      @if (title()) {
        <p class="text-sm font-medium mb-1">{{ title() }}</p>
      }
      <div
        echarts
        [options]="chartOptions()"
        [merge]="null"
        class="chart"
        [style.height.px]="chartHeight()"
      ></div>
    </div>
  `,
  styles: [
    `
      .chart {
        width: 100%;
        min-height: 200px;
      }
    `,
  ],
})
export class ChartContainerComponent {
  series = input.required<ChartSeriesInput[]>();
  title = input<string>('');
  height = input<number>(320);

  chartHeight = computed(() => Math.max(200, this.height() - (this.title() ? 32 : 16)));

  chartOptions = computed<EChartsOption>(() => {
    const list = this.series();
    const option: EChartsOption = {
      tooltip: { trigger: 'axis' },
      legend: { type: 'scroll', bottom: 0 },
      grid: { left: '3%', right: '4%', bottom: '15%', top: '10%', containLabel: true },
      xAxis: { type: 'time', splitLine: { show: false } },
      yAxis: { type: 'value', splitLine: { lineStyle: { type: 'dashed', opacity: 0.5 } } },
      series: list.map((s) => ({
        name: s.name,
        type: 'line',
        smooth: true,
        symbol: 'none',
        data: (s.data ?? []).map((p) => [new Date(p.ts).getTime(), p.value]),
      })),
    };
    return option;
  });
}
