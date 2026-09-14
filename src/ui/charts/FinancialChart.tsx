import { useId, useMemo, useState } from "react";
import type { ChartPoint, ChartSeries } from "../../../lib/charts/series.ts";
import { money, ratio, shortFiscalRange } from "../format.ts";

function formatValue(series: ChartSeries, value: number | null): string {
  if (value === null) return "Not available";
  if (series.unit === "usd") return money(value);
  if (series.unit === "percent") return `${(value * 100).toFixed(1)}%`;
  if (series.unit === "score") return String(Math.round(value));
  return ratio(value);
}

function axisLabel(series: ChartSeries, value: number): string {
  if (series.unit === "usd") return money(value);
  if (series.unit === "percent") return `${(value * 100).toFixed(0)}%`;
  return ratio(value);
}

function numericValues(series: ChartSeries, extra?: ChartSeries | null): number[] {
  return [...series.points, ...(extra?.points ?? [])]
    .map((point) => point.value)
    .filter((value): value is number => value !== null && Number.isFinite(value));
}

export function FinancialChart({
  series,
  extra = null,
  compact = false,
  signed = false,
  display = "chart",
  onToggleDisplay,
}: {
  series: ChartSeries;
  extra?: ChartSeries | null;
  compact?: boolean;
  signed?: boolean;
  display?: "chart" | "table";
  onToggleDisplay?: (next: "chart" | "table") => void;
}) {
  const titleId = useId();
  const [active, setActive] = useState<string | null>(null);
  const values = numericValues(series, extra);
  const hasNegative = values.some((value) => value < 0);
  const useSigned = signed || hasNegative;
  const max = values.length ? Math.max(...values.map(Math.abs), values.includes(0) ? 0 : 1) : 1;
  const domainMax = max;
  const domainMin = useSigned ? -max : 0;
  const height = compact ? 220 : 460;
  const width = 960;
  const padLeft = 88;
  const padRight = 24;
  const padTop = 20;
  const padBottom = 56;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;
  const ticks = useMemo(() => {
    const count = compact ? 3 : 5;
    return Array.from({ length: count }, (_, index) => domainMin + ((domainMax - domainMin) * index) / (count - 1));
  }, [compact, domainMax, domainMin]);

  function yFor(value: number): number {
    const span = domainMax - domainMin || 1;
    return padTop + ((domainMax - value) / span) * plotHeight;
  }

  const zeroY = yFor(0);
  const count = Math.max(series.points.length, 1);
  const groupWidth = plotWidth / count;
  const barWidth = Math.min(36, extra ? groupWidth * 0.32 : groupWidth * 0.46);

  function activate(point: ChartPoint) {
    setActive(point.reportId);
  }

  return (
    <figure className={`chart-block ${compact ? "is-compact" : "is-large"}`}>
      <figcaption className="chart-caption">
        <div>
          <strong>{extra ? `${series.title} and ${extra.title}` : series.title}</strong>
          <p className="tiny">{series.question}</p>
          <p className="tiny">{series.comparabilityNote}</p>
          <p className="chart-unit">{series.unit === "usd" ? "USD" : series.unit === "percent" ? "Percent" : series.unit === "ratio" ? "Ratio" : series.unit}</p>
        </div>
        <div className="chart-toolbar">
          {onToggleDisplay ? (
            <div className="view-toggle" role="group" aria-label="Chart or data table">
              <button type="button" className={display === "chart" ? "tab active" : "tab"} onClick={() => onToggleDisplay("chart")}>
                Chart
              </button>
              <button type="button" className={display === "table" ? "tab active" : "tab"} onClick={() => onToggleDisplay("table")}>
                Data table
              </button>
            </div>
          ) : null}
        </div>
      </figcaption>

      {display === "table" ? (
        <div className="chart-table-wrap" tabIndex={0}>
          <table className="chart-table">
            <thead>
              <tr>
                <th scope="col">Fiscal period</th>
                <th scope="col">{series.title}</th>
                {extra ? <th scope="col">{extra.title}</th> : null}
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              {series.points.map((point, index) => (
                <tr key={point.reportId}>
                  <td>{shortFiscalRange(point.start, point.end)}</td>
                  <td>{point.excluded ? "Excluded" : formatValue(series, point.value)}</td>
                  {extra ? (
                    <td>{extra.points[index]?.excluded ? "Excluded" : formatValue(extra, extra.points[index]?.value ?? null)}</td>
                  ) : null}
                  <td>{point.exclusion ?? extra?.points[index]?.exclusion ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <svg
            className="chart-svg"
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-labelledby={titleId}
          >
            <title id={titleId}>{extra ? `${series.title} and ${extra.title}` : series.title}</title>
            {ticks.map((tick) => (
              <g key={tick}>
                <line className="chart-grid" x1={padLeft} x2={width - padRight} y1={yFor(tick)} y2={yFor(tick)} />
                <text className="chart-tick" x={padLeft - 10} y={yFor(tick) + 5} textAnchor="end">
                  {axisLabel(series, tick)}
                </text>
              </g>
            ))}
            <line className="chart-axis" x1={padLeft} x2={width - padRight} y1={zeroY} y2={zeroY} />
            {series.points.map((point, index) => {
              const pair = extra?.points[index];
              const cx = padLeft + index * groupWidth + groupWidth / 2;
              const left = extra ? cx - barWidth - 4 : cx - barWidth / 2;
              return (
                <g key={point.reportId}>
                  {drawBar(point, left, barWidth, zeroY, yFor, "chart-bar", () => activate(point))}
                  {pair
                    ? drawBar(pair, left + barWidth + 8, barWidth, zeroY, yFor, "chart-bar alt", () => activate(point))
                    : null}
                  <text className="chart-tick chart-x" x={cx} y={height - 18} textAnchor="middle">
                    {shortFiscalRange(point.start, point.end).replace(" – ", "–")}
                  </text>
                </g>
              );
            })}
          </svg>
          <ul className="chart-legend">
            <li>
              <span className="swatch swatch-a" />
              {series.title}
            </li>
            {extra ? (
              <li>
                <span className="swatch swatch-b" />
                {extra.title}
              </li>
            ) : null}
            <li>
              <span className="swatch swatch-gap" />
              Missing or excluded
            </li>
          </ul>
          {active ? (
            <p className="chart-tooltip" role="status">
              {tooltipText(series, extra, active)}
            </p>
          ) : (
            <p className="tiny">Tap, click, or focus a bar for the exact value. Missing observations are gaps, not zeros.</p>
          )}
        </>
      )}
      <details>
        <summary>Sources / How calculated</summary>
        <p className="tiny">{series.definition}</p>
        {extra ? <p className="tiny">{extra.definition}</p> : null}
        <p className="tiny">{series.comparabilityNote}</p>
        <p className="tiny">Value axis includes zero. Incomparable CMS file-cohort years are not treated as consecutive fiscal periods.</p>
      </details>
    </figure>
  );
}

function tooltipText(series: ChartSeries, extra: ChartSeries | null, reportId: string): string {
  const point = series.points.find((item) => item.reportId === reportId);
  const pair = extra?.points.find((item) => item.reportId === reportId);
  if (!point) return "";
  const period = shortFiscalRange(point.start, point.end);
  const first = `${series.title}: ${point.excluded ? "Excluded" : formatValue(series, point.value)}`;
  const second = pair ? ` · ${extra?.title}: ${pair.excluded ? "Excluded" : formatValue(extra!, pair.value)}` : "";
  const note = point.exclusion ?? pair?.exclusion;
  return `${period} · ${first}${second}${note ? ` · ${note}` : ""}`;
}

function drawBar(
  point: ChartPoint,
  x: number,
  width: number,
  zeroY: number,
  yFor: (value: number) => number,
  className: string,
  onActivate: () => void,
) {
  if (point.value === null || point.excluded) {
    return (
      <rect
        className="chart-gap"
        x={x}
        y={zeroY - 10}
        width={width}
        height={20}
        tabIndex={0}
        role="img"
        aria-label={`${shortFiscalRange(point.start, point.end)}: ${point.exclusion ?? "Not available"}`}
        onClick={onActivate}
        onFocus={onActivate}
      >
        <title>{point.exclusion ?? "Not available"}</title>
      </rect>
    );
  }
  const y = yFor(point.value);
  const top = Math.min(y, zeroY);
  const height = Math.max(2, Math.abs(zeroY - y));
  return (
    <rect
      className={className}
      x={x}
      y={top}
      width={width}
      height={height}
      tabIndex={0}
      role="img"
      aria-label={`${shortFiscalRange(point.start, point.end)}: ${point.value}`}
      onClick={onActivate}
      onFocus={onActivate}
    >
      <title>{`${shortFiscalRange(point.start, point.end)}: ${point.value}`}</title>
    </rect>
  );
}
