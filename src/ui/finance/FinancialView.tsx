import { useMemo, useState } from "react";
import { utilizationSeries } from "../../../lib/charts/series.ts";
import {
  FINANCIAL_VIEW_OPTIONS,
  filterReportsByRange,
  seriesForView,
  viewHasValues,
  type FinancialViewId,
} from "../../../lib/charts/views.ts";
import type { HospitalView } from "../../types.ts";
import { FinancialChart } from "../charts/FinancialChart.tsx";
import { shortFiscalRange } from "../format.ts";

export function FinancialView({
  view,
  reports,
  selectedView,
  onViewChange,
}: {
  view: HospitalView;
  reports: HospitalView[];
  selectedView: FinancialViewId;
  onViewChange: (id: FinancialViewId) => void;
}) {
  const ordered = useMemo(
    () => [...reports].sort((left, right) => left.hospital.fiscalYearEnd.localeCompare(right.hospital.fiscalYearEnd)),
    [reports],
  );
  const [display, setDisplay] = useState<"chart" | "table">("chart");
  const [from, setFrom] = useState(ordered[0]?.hospital.fiscalYearEnd ?? "");
  const [to, setTo] = useState(ordered.at(-1)?.hospital.fiscalYearEnd ?? "");
  const option = FINANCIAL_VIEW_OPTIONS.find((item) => item.id === selectedView) ?? FINANCIAL_VIEW_OPTIONS[0]!;
  const ranged = useMemo(() => filterReportsByRange(ordered, from || null, to || null), [ordered, from, to]);
  const usable = ranged.length > 0 ? ranged : ordered;
  const pair = seriesForView(selectedView, usable);
  const available = viewHasValues(selectedView, reports);
  const utilization = utilizationSeries(reports);

  return (
    <section className="financial-view" aria-labelledby="financial-view-title">
      <div className="financial-view-controls">
        <label>
          <span>Financial view</span>
          <select
            id="financial-view-title"
            value={selectedView}
            onChange={(event) => {
              onViewChange(event.target.value as FinancialViewId);
              setDisplay("chart");
            }}
          >
            {FINANCIAL_VIEW_OPTIONS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>From fiscal end</span>
          <select value={from} onChange={(event) => setFrom(event.target.value)}>
            {ordered.map((report) => (
              <option key={`from-${report.hospital.id}`} value={report.hospital.fiscalYearEnd}>
                {shortFiscalRange(report.hospital.fiscalYearStart, report.hospital.fiscalYearEnd)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>To fiscal end</span>
          <select value={to} onChange={(event) => setTo(event.target.value)}>
            {ordered.map((report) => (
              <option key={`to-${report.hospital.id}`} value={report.hospital.fiscalYearEnd}>
                {shortFiscalRange(report.hospital.fiscalYearStart, report.hospital.fiscalYearEnd)}
              </option>
            ))}
          </select>
        </label>
        <p className="tiny chart-unit-note">
          {option.unitNote}. Selected report {shortFiscalRange(view.hospital.fiscalYearStart, view.hospital.fiscalYearEnd)}.
        </p>
      </div>

      <div className="financial-view-layout">
        <aside className="chart-takeaway">
          <h3>What this measure means</h3>
          <p>{option.definition}</p>
          <p className="tiny">
            The comparison above uses the selected report and the immediately preceding available report. Changing this
            chart does not change that pair.
          </p>
        </aside>
        <div id="financial-chart-region" className="chart-stage" tabIndex={-1}>
          {!available ? (
            <p className="empty-copy">
              {option.label} is not available from the current reports. The option stays listed so the gap is visible.
            </p>
          ) : selectedView === "cash_liquidity" ? (
            <>
              <FinancialChart series={pair.primary} display={display} onToggleDisplay={setDisplay} />
              {pair.secondary ? (
                <FinancialChart
                  series={pair.secondary}
                  display={display}
                  onToggleDisplay={setDisplay}
                />
              ) : null}
            </>
          ) : (
            <FinancialChart
              series={pair.primary}
              extra={selectedView === "npr_expenses" || selectedView === "assets_liabilities" ? pair.secondary : null}
              signed={selectedView === "patient_service_result"}
              display={display}
              onToggleDisplay={setDisplay}
            />
          )}
        </div>
      </div>

      <details className="operational-separate">
        <summary>Operational utilization (not a financial result)</summary>
        <FinancialChart series={utilization} compact />
      </details>
    </section>
  );
}
