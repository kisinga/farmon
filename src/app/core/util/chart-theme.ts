import type { EChartsOption } from 'echarts';
import { BRAND, NEUTRAL, STATE_COLORS } from '@core';

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

/** One line on a {@link vitalsConnectivityOption} chart, bound to one of its y-axes. */
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

/** One y-axis on the vitals grid of a {@link vitalsConnectivityOption} chart. */
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

/** One stretch of the connectivity band (millisecond-epoch bounds). */
export interface ConnectivitySeg { start: number; end: number; online: boolean; unknown?: boolean }
/** The connectivity band drawn under the vitals: online/offline stretches + reboots. */
export interface ConnectivityBand { segments: ConnectivitySeg[]; reboots: number[] }

/** Band fills — online green, offline red, no-data muted (canonical state palette). */
const BAND_ONLINE = STATE_COLORS.active;
const BAND_OFFLINE = STATE_COLORS.fault;
const BAND_UNKNOWN = NEUTRAL.slate700;
const BAND_REBOOT = STATE_COLORS.warn;

const fmtStamp = (ms: number) =>
  new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * The device-health chart: a multi-axis vitals plot (free RAM in KB, WiFi in dBm,
 * temperature in °C — each on its own y-axis, real values intact) stacked above a thin
 * CONNECTIVITY band (online green / offline red, with reboot ticks), both on the SAME
 * time x-axis. One shared `dataZoom` ranges both grids together and a linked
 * `axisPointer` cross-hairs them, so hovering either highlights the matching instant on
 * the other; the tooltip lists every vital at that time plus the connectivity status.
 * The band is a `custom` series of rectangles, one per stretch. `range` pins both
 * x-axes to the same window so the two grids align pixel-for-pixel.
 */
export function vitalsConnectivityOption(
  series: MultiAxisSeries[],
  axes: MultiAxisDef[],
  band: ConnectivityBand,
  range: { from: number; to: number },
): EChartsOption {
  const segFill = (s: ConnectivitySeg) => (s.unknown ? BAND_UNKNOWN : s.online ? BAND_ONLINE : BAND_OFFLINE);
  // The band rects (custom renderItem) are typed loosely by ECharts; assemble the
  // series array as `any` so the line + custom mix doesn't fight the union typing.
  const bandSeries: any = {
    type: 'custom', xAxisIndex: 1, yAxisIndex: axes.length,
    renderItem: (params: any, api: any) => {
      const seg = band.segments[api.value(2)];
      if (!seg) return;
      const p0 = api.coord([seg.start, 0]);
      const p1 = api.coord([seg.end, 0]);
      const yTop = api.coord([seg.start, 1])[1];
      const cs = params.coordSys;
      const left = Math.max(p0[0], cs.x);
      const right = Math.min(p1[0], cs.x + cs.width);
      if (right <= left) return;
      return { type: 'rect', shape: { x: left, y: yTop, width: right - left, height: p0[1] - yTop }, style: { fill: segFill(seg) } };
    },
    data: band.segments.map((s, i) => [s.start, s.end, i]),
    markLine: band.reboots.length ? {
      silent: true, symbol: 'none', label: { show: false },
      lineStyle: { color: BAND_REBOOT, width: 1 },
      data: band.reboots.map((t) => ({ xAxis: t })),
    } : undefined,
  };
  return {
    textStyle: { color: CHART.label },
    grid: [
      { left: 48, right: 78, top: 30, height: 158 }, // vitals
      { left: 48, right: 78, top: 200, height: 20 }, // connectivity band
    ],
    legend: {
      top: 2, right: 8,
      data: series.map((s) => s.name),
      textStyle: { color: CHART.label },
      inactiveColor: CHART.axis,
    },
    xAxis: [
      {
        type: 'time', gridIndex: 0, min: range.from, max: range.to,
        axisLine: { lineStyle: { color: CHART.axis } },
        axisLabel: { show: false },
        splitLine: { show: false },
      },
      {
        type: 'time', gridIndex: 1, min: range.from, max: range.to,
        axisLine: { lineStyle: { color: CHART.axis } },
        axisLabel: { color: CHART.label },
        splitLine: { show: false },
      },
    ],
    yAxis: [
      ...axes.map((a, i) => ({
        type: 'value' as const, gridIndex: 0,
        position: a.position,
        offset: a.offset ?? 0,
        min: a.min,
        max: a.max,
        axisLine: { show: true, lineStyle: { color: a.color } },
        axisLabel: { color: a.color, formatter: a.formatter ?? '{value}' },
        // Only the first axis draws horizontal gridlines; the rest would overlap it.
        splitLine: { show: i === 0, lineStyle: { color: CHART.axis } },
      })),
      { type: 'value' as const, gridIndex: 1, min: 0, max: 1, show: false },
    ],
    // Cross-hair both grids off the same time pointer — hover one, see the other.
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: CHART.label, width: 1, type: 'dashed' } },
      // Lines read in their own unit (per-series `fmt`); append the connectivity status
      // at the hovered time, looked up from the band segments.
      formatter: (params: any) => {
        const arr = Array.isArray(params) ? params : [params];
        if (!arr.length) return '';
        const a0 = arr[0];
        const ts = Number(a0.axisValue ?? (Array.isArray(a0.value) ? a0.value[0] : 0));
        const rows: string[] = [];
        for (const p of arr) {
          if (p.seriesType !== 'line') continue;
          const v = Array.isArray(p.value) ? p.value[1] : p.value;
          const f = series[p.seriesIndex]?.fmt;
          rows.push(`${p.marker} ${p.seriesName}: ${v == null ? '—' : f ? f(Number(v)) : String(v)}`);
        }
        const seg = band.segments.find((s) => ts >= s.start && ts <= s.end);
        if (seg) {
          const label = seg.unknown ? 'No data' : seg.online ? 'Online' : 'Offline';
          const dot = `<span style="display:inline-block;margin-right:5px;width:9px;height:9px;border-radius:2px;background:${segFill(seg)}"></span>`;
          rows.push(`${dot}Connectivity: ${label}`);
        }
        return [fmtStamp(ts), ...rows].join('<br/>');
      },
    },
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1], throttle: 50 },
      {
        type: 'slider', xAxisIndex: [0, 1], height: 16, bottom: 8,
        borderColor: 'transparent',
        fillerColor: ZOOM_FILL,
        handleStyle: { color: CHART.accent },
        textStyle: { color: CHART.label },
        dataBackground: { lineStyle: { color: CHART.axis }, areaStyle: { color: ZOOM_BG_FILL } },
      },
    ],
    series: [
      ...series.map((s) => ({
        name: s.name, type: 'line' as const, showSymbol: false, smooth: true,
        xAxisIndex: 0, yAxisIndex: s.axisIndex,
        data: s.data,
        lineStyle: { color: s.color, width: 2 }, itemStyle: { color: s.color },
      })),
      bandSeries,
    ],
  };
}
