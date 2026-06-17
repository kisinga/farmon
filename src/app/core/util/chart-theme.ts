import type { EChartsOption } from 'echarts';
import { BRAND, NEUTRAL } from '@core';

/**
 * ECharts colours for the dark majiflow dashboard widgets.
 *
 * ECharts paints to <canvas>, which can't read CSS custom properties, so the
 * values come from the canonical lib palette (src/lib/colors.ts) — the same
 * source the styles.css `@theme` ramp mirrors. Module-level const (stable
 * reference) so the per-widget option `computed()`s don't see a new object each
 * telemetry tick and force a needless re-render.
 */
export const CHART = {
  axis: NEUTRAL.slate700, // axis / split lines
  label: NEUTRAL.slate400, // tick labels
  accent: BRAND.cyan, // series + gauge progress (= --color-primary)
  text: NEUTRAL.slate200, // value readout
} as const;

/** Translucent cyan fills for the history charts (all = --color-primary at low alpha). */
const AREA_FILL = 'rgba(34,211,238,0.14)'; // line area under the curve
const ZOOM_FILL = 'rgba(34,211,238,0.15)'; // selected window in the zoom slider
const ZOOM_BG_FILL = 'rgba(34,211,238,0.08)'; // slider's mini-preview area

/** Per-chart value-scale specifics; everything else is shared. */
export interface HistoryChartOpts {
  /** Fixed y-axis bounds (e.g. tanks pin 0–100). */
  yMin?: number;
  yMax?: number;
  /** y-axis tick label template (ECharts string formatter, e.g. '{value}%'). */
  yAxisFormatter?: string;
  /** Tooltip value formatter. */
  tooltipValueFormatter?: (value: number | string) => string;
}

/**
 * The single ECharts option for every history line chart — the tank level
 * history and the flow/line widgets — so their axes, grid, zoom slider and the
 * line + area all render identically. Callers pass the `[ts, value]` data and
 * only override the value-scale bits (bounds / formatters) that genuinely differ.
 */
export function historyLineOption(
  data: (number | string | null)[][],
  opts: HistoryChartOpts = {},
): EChartsOption {
  return {
    textStyle: { color: CHART.label },
    grid: { left: 44, right: 14, top: 12, bottom: 44 },
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: CHART.axis } },
      axisLabel: { color: CHART.label },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      min: opts.yMin,
      max: opts.yMax,
      axisLine: { show: false },
      axisLabel: { color: CHART.label, formatter: opts.yAxisFormatter },
      splitLine: { lineStyle: { color: CHART.axis } },
    },
    tooltip: {
      trigger: 'axis',
      valueFormatter: opts.tooltipValueFormatter
        ? (value) => opts.tooltipValueFormatter!(value as number | string)
        : undefined,
    },
    dataZoom: [
      { type: 'inside', throttle: 50 },
      {
        type: 'slider', height: 18, bottom: 8,
        borderColor: 'transparent',
        fillerColor: ZOOM_FILL,
        handleStyle: { color: CHART.accent },
        textStyle: { color: CHART.label },
        dataBackground: { lineStyle: { color: CHART.axis }, areaStyle: { color: ZOOM_BG_FILL } },
      },
    ],
    series: [{
      type: 'line', showSymbol: false, smooth: true, data,
      lineStyle: { color: CHART.accent, width: 2 },
      itemStyle: { color: CHART.accent },
      areaStyle: { color: AREA_FILL },
    }],
  };
}
