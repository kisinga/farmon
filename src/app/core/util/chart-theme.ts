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

/** One line on a {@link multiAxisHistoryOption} chart, bound to one of its y-axes. */
export interface MultiAxisSeries {
  /** Legend + tooltip name (carry the unit here, e.g. "RAM (KB)"). */
  name: string;
  /** `[ts, value]` pairs, already scaled to the bound axis's unit. */
  data: (number | string | null)[][];
  /** Line + axis-label colour (a canonical palette hex). */
  color: string;
  /** Index into the `axes` array this series is plotted against. */
  axisIndex: number;
  /** Tooltip value formatter (value is in the axis unit). */
  fmt: (value: number) => string;
}

/** One y-axis on a {@link multiAxisHistoryOption} chart. */
export interface MultiAxisDef {
  color: string;
  position: 'left' | 'right';
  /** Pixels to push a right axis further right (so two right axes don't overlap). */
  offset?: number;
  min?: number;
  max?: number;
  /** Tick-label template (ECharts string formatter, e.g. '{value}°'). */
  formatter?: string;
}

/**
 * A time-series line chart with several independently-scaled y-axes — for plotting
 * metrics in different units (e.g. free RAM in KB, WiFi in dBm, temperature in °C) on
 * ONE chart with their real values intact. Shares the grid, time axis, zoom slider and
 * tooltip styling of {@link historyLineOption}; each series keeps its own axis + colour,
 * and the tooltip lists every series at the hovered time with its own unit. Only the
 * first axis draws horizontal gridlines (more would muddy the plot).
 */
export function multiAxisHistoryOption(series: MultiAxisSeries[], axes: MultiAxisDef[]): EChartsOption {
  return {
    textStyle: { color: CHART.label },
    grid: { left: 48, right: 78, top: 30, bottom: 44 },
    legend: {
      top: 2, right: 8,
      data: series.map((s) => s.name),
      textStyle: { color: CHART.label },
      inactiveColor: CHART.axis,
    },
    xAxis: {
      type: 'time',
      axisLine: { lineStyle: { color: CHART.axis } },
      axisLabel: { color: CHART.label },
      splitLine: { show: false },
    },
    yAxis: axes.map((a, i) => ({
      type: 'value' as const,
      position: a.position,
      offset: a.offset ?? 0,
      min: a.min,
      max: a.max,
      axisLine: { show: true, lineStyle: { color: a.color } },
      axisLabel: { color: a.color, formatter: a.formatter ?? '{value}' },
      // Only the first axis draws horizontal gridlines; the rest would overlap it.
      splitLine: { show: i === 0, lineStyle: { color: CHART.axis } },
    })),
    tooltip: {
      trigger: 'axis',
      // Each series reads in its own unit, so the shared axis formatter can't serve —
      // map every hovered series back to its own `fmt` by series index.
      formatter: (params: any) => {
        const arr = Array.isArray(params) ? params : [params];
        if (!arr.length) return '';
        const raw0 = Array.isArray(arr[0].value) ? arr[0].value[0] : arr[0].axisValue;
        const d = new Date(typeof raw0 === 'number' ? raw0 : Date.parse(String(raw0)));
        const head = d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const rows = arr.map((p: any) => {
          const v = Array.isArray(p.value) ? p.value[1] : p.value;
          const f = series[p.seriesIndex]?.fmt;
          return `${p.marker} ${p.seriesName}: ${v == null ? '—' : f ? f(Number(v)) : String(v)}`;
        });
        return [head, ...rows].join('<br/>');
      },
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
    series: series.map((s) => ({
      name: s.name, type: 'line', showSymbol: false, smooth: true,
      data: s.data, yAxisIndex: s.axisIndex,
      lineStyle: { color: s.color, width: 2 }, itemStyle: { color: s.color },
    })),
  };
}
