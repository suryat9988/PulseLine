import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FinancialViewId } from "../../lib/charts/views.ts";
import { diligenceGaps, EMPTY_EVENT_LEDGER } from "../../lib/diligence/gaps.ts";
import { evaluateScenario, resetScenarioInputs } from "../../lib/scenario/whatif.ts";
import type { AskContext, PulseAnswer } from "../../lib/ask/index.ts";
import type { EvidenceHospital, EvidenceObservation, HospitalView, StructuralEvent } from "../types.ts";
import { AskPane } from "./ask/AskPane.tsx";
import { GapList } from "./diligence/GapList.tsx";
import { ContextObservations, EventTimeline } from "./EventTimeline.tsx";
import { FinancialCards } from "./finance/FinancialCards.tsx";
import { FinancialStatements } from "./finance/FinancialStatements.tsx";
import { FinancialView } from "./finance/FinancialView.tsx";
import { PeriodMeta } from "./finance/PeriodMeta.tsx";
import { WhatChangedPanel } from "./finance/WhatChanged.tsx";
import { factorDisplay, StatusGlyph } from "./hospital-display.tsx";
import { fiscalLabel, shortFiscalRange, statusClass } from "./format.ts";
import { WhatIfPanel } from "./scenario/WhatIfPanel.tsx";
import { ScoreRubricPanel } from "./score/ScoreRubric.tsx";

export type WorkspacePane = "overview" | "financials" | "scenarios" | "evidence" | "ask";

const PANE_LABELS: Record<WorkspacePane, string> = {
  overview: "Overview",
  financials: "Financials",
  scenarios: "Scenarios",
  evidence: "Evidence",
  ask: "Ask",
};

function useWideSplit() {
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 1100px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1100px)");
    const onChange = () => setWide(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return wide;
}

function OverviewPane({
  view,
  reports,
  financialView,
  onFinancialView,
  onOpenAbout,
}: {
  view: HospitalView | null;
  reports: HospitalView[];
  financialView: FinancialViewId;
  onFinancialView: (id: FinancialViewId) => void;
  onOpenAbout?: () => void;
}) {
  if (!view) {
    return null;
  }
  return (
    <section className="content-panel">
      <FinancialView
        key={view.hospital.hospitalId}
        view={view}
        reports={reports}
        selectedView={financialView}
        onViewChange={onFinancialView}
      />
      <FinancialCards view={view} />
      <aside className="score-secondary">
        <p className="label">Experimental concern score</p>
        <p className="tiny">Secondary to the financial records. Not acquisition attractiveness or a forecast.</p>
        <ScoreRubricPanel result={view.financial} compact onOpenAbout={onOpenAbout} />
      </aside>
    </section>
  );
}

function FinancialsPane({ view, reports }: { view: HospitalView | null; reports: HospitalView[] }) {
  if (!view) {
    return (
      <section className="content-panel">
        <h3>Financials</h3>
        <p className="status-pill status-pending">Financial data pending</p>
        <p>Charts and statements stay disabled until sourced financials exist.</p>
      </section>
    );
  }
  return (
    <section className="content-panel">
      <FinancialStatements reports={reports} />
      <details className="metric-source-panel">
        <summary>Score metric formulas and sources</summary>
        <ul className="signal-list">
          {view.financial.factors.map((factor) => (
            <li key={factor.id}>
              <div className="signal-head">
                <strong>{factor.metric}</strong>
                <span>{factorDisplay(factor)}</span>
              </div>
              <p className="tiny">{factor.formula}</p>
            </li>
          ))}
        </ul>
        <p className="tiny">
          Source:{" "}
          {view.hospital.sourceUrl ? (
            <a href={view.hospital.sourceUrl} target="_blank" rel="noreferrer">
              {view.hospital.sourceId ?? "CMS cost report"}
            </a>
          ) : (
            view.hospital.dataQuality.source
          )}{" "}
          · Report {view.hospital.reportRecordId ?? "Unknown"} · File cohort {view.hospital.fileCohort ?? "Unknown"} ·{" "}
          {fiscalLabel(view.hospital.fiscalYearStart, view.hospital.fiscalYearEnd)}
        </p>
      </details>
    </section>
  );
}

function EvidencePane({
  view,
  research,
  events,
  observations,
  pending,
}: {
  view: HospitalView | null;
  research: EvidenceHospital | null;
  events: StructuralEvent[];
  observations: EvidenceObservation[];
  pending: boolean;
}) {
  const gaps = diligenceGaps({ view, research, events, observations, pending });
  return (
    <section className="content-panel">
      <h3>Evidence</h3>
      <p className="muted small">
        Identity and transaction scope stay separate from the financial records. A blank event log is not a finding that
        no events occurred. County access is not hospital staffing.
      </p>
      {events.length > 0 ? <EventTimeline events={events} /> : <p className="tiny">{EMPTY_EVENT_LEDGER}</p>}
      <GapList gaps={gaps} />
      <ContextObservations observations={observations} domain="operational" title="Hospital pressure context" />
      <ContextObservations
        observations={observations}
        domain="community"
        title="Community context"
        contextNote="Community statistics speak to local access and service continuity. They are not hospital staffing counts and do not measure a transaction’s effect unless a sourced record says so."
      />
      <ContextObservations
        observations={observations}
        domain="workforce_access"
        title="County access context"
        contextNote="County access measures are not hospital employee counts and are kept separate from hospital financials."
      />
    </section>
  );
}

function EvidenceShelf({
  reports,
  view,
  onSelectReport,
}: {
  reports: HospitalView[];
  view: HospitalView | null;
  onSelectReport: (id: string) => void;
}) {
  return (
    <aside className="evidence-shelf" aria-label="Evidence shelf">
      <h3>Selected period</h3>
      <p className="tiny">
        {reports.length > 0 ? `${reports.length} fiscal reports available` : "No CMS fiscal reports in PulseLine yet."}
      </p>
      <div className="shelf-years">
        {reports.map((report) => (
          <button
            type="button"
            key={report.hospital.id}
            className={report.hospital.id === view?.hospital.id ? "shelf-year active" : "shelf-year"}
            onClick={() => onSelectReport(report.hospital.id)}
          >
            {shortFiscalRange(report.hospital.fiscalYearStart, report.hospital.fiscalYearEnd)}
          </button>
        ))}
      </div>
      {view ? <PeriodMeta view={view} /> : <p className="tiny">Financial data pending</p>}
    </aside>
  );
}

export function HospitalWorkspace({
  title,
  subtitle,
  pending,
  view,
  reports,
  events,
  observations,
  research,
  askContext,
  answers,
  selectedIds,
  onAnswers,
  onSelectedIds,
  onClearConversation,
  onSelectReport,
  onClose,
  onOpenAbout,
}: {
  title: string;
  subtitle: string;
  pending: boolean;
  view: HospitalView | null;
  reports: HospitalView[];
  events: StructuralEvent[];
  observations: EvidenceObservation[];
  research: EvidenceHospital | null;
  askContext: AskContext;
  answers: PulseAnswer[];
  selectedIds: string[];
  onAnswers: (answers: PulseAnswer[]) => void;
  onSelectedIds: (ids: string[]) => void;
  onClearConversation: () => void;
  onSelectReport: (id: string) => void;
  onClose: () => void;
  onOpenAbout?: () => void;
}) {
  const [pane, setPane] = useState<WorkspacePane>("overview");
  const [financialView, setFinancialView] = useState<FinancialViewId>("npr_expenses");
  const [scenarioByReport, setScenarioByReport] = useState<Record<string, ReturnType<typeof resetScenarioInputs>>>({});
  const reportKey = view?.hospital.id ?? "pending";
  const scenarioInputs = scenarioByReport[reportKey] ?? resetScenarioInputs();
  const scenario = useMemo(
    () => evaluateScenario(view, scenarioInputs, { pending, hospitalName: title }),
    [view, scenarioInputs, pending, title],
  );
  const askWithScenario = useMemo(() => ({ ...askContext, scenario }), [askContext, scenario]);
  const wide = useWideSplit();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [barSentinel, setBarSentinel] = useState<HTMLDivElement | null>(null);
  const [compactBar, setCompactBar] = useState(false);
  const [slotMinHeight, setSlotMinHeight] = useState(0);
  const onCloseRef = useRef(onClose);
  const openedId = view?.hospital.hospitalId ?? research?.hospitalId ?? title;
  const ccnLine = view
    ? [
        view.hospital.historicalCcn ? `Reported CCN ${view.hospital.historicalCcn}` : null,
        view.hospital.currentCcn && view.hospital.currentCcn !== view.hospital.historicalCcn
          ? `Current CCN ${view.hospital.currentCcn}`
          : view.hospital.ccnAsReported && !view.hospital.historicalCcn
            ? `Reported CCN ${view.hospital.ccnAsReported}`
            : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    headingRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const target = event.target;
      if (target instanceof Element && !target.closest(".workspace")) return;
      event.preventDefault();
      onCloseRef.current();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openedId]);

  useEffect(() => {
    setCompactBar(false);
    setSlotMinHeight(0);
  }, [openedId]);

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar || compactBar) return;
    const sync = () => setSlotMinHeight(bar.offsetHeight);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [compactBar, openedId, title, pending, reports.length, view?.hospital.id]);

  useEffect(() => {
    if (!barSentinel) return;
    let frame = 0;
    function update() {
      const top = barSentinel.getBoundingClientRect().top;
      setCompactBar((current) => {
        if (!current && top < -24) return true;
        if (current && top >= 8) return false;
        return current;
      });
    }
    function onScroll() {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    }
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [barSentinel]);

  const showAskDesk = pane === "ask" && wide;

  return (
    <section id="hospital-financials" className="workspace is-inline" aria-labelledby="workspace-title">
      <div ref={setBarSentinel} className="hospital-bar-sentinel" aria-hidden="true" />
      <div className="hospital-bar-slot" style={slotMinHeight > 0 ? { minHeight: slotMinHeight } : undefined}>
        <div ref={barRef} className={`hospital-bar is-sticky${compactBar ? " is-compact" : ""}`}>
        <div className="hospital-bar-identity">
          <h2 id="workspace-title" ref={headingRef} tabIndex={-1}>
            {title}
          </h2>
          <div className="hospital-bar-meta">
            <p className="muted">
              {[subtitle, ccnLine].filter(Boolean).join(" · ")}
              {pending ? " · Financial data pending" : ""}
            </p>
            {view?.hospital.dataQuality.identityStatus === "unresolved" ? (
              <p className="tiny">Identity: review required</p>
            ) : null}
          </div>
        </div>
        <div className="hospital-bar-actions">
          {reports.length > 0 ? (
            <label className="period-select sticky-period">
              <span className={compactBar ? "visually-hidden" : undefined}>Reporting period</span>
              <select value={view?.hospital.id ?? ""} onChange={(event) => onSelectReport(event.target.value)}>
                {reports.map((report) => (
                  <option key={report.hospital.id} value={report.hospital.id}>
                    {shortFiscalRange(report.hospital.fiscalYearStart, report.hospital.fiscalYearEnd)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {pending ? (
            <p className="status-pill status-pending">
              <StatusGlyph status="pending" />
              Financial data pending
            </p>
          ) : view ? (
            <p className={`status-pill ${statusClass(view.financial.status)}`}>
              <StatusGlyph status={view.financial.status} />
              {compactBar
                ? `Experimental ${view.financial.score ?? "none"} · ${view.financial.status}`
                : `Experimental score ${view.financial.score ?? "none"}`}
            </p>
          ) : null}
          <button type="button" className="chip chip-quiet" onClick={onClose}>
            Close
          </button>
        </div>
        </div>
      </div>
      {view ? <PeriodMeta view={view} /> : null}

      <div className="workspace-tabs" role="tablist" aria-label="Hospital sections">
        {(Object.keys(PANE_LABELS) as WorkspacePane[]).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={pane === item}
            className={pane === item ? "tab active" : "tab"}
            onClick={() => setPane(item)}
          >
            {PANE_LABELS[item]}
          </button>
        ))}
      </div>

      {showAskDesk ? (
        <div className="ask-desk">
          <EvidenceShelf reports={reports} view={view} onSelectReport={onSelectReport} />
          <AskPane
            context={askWithScenario}
            answers={answers}
            selectedIds={selectedIds}
            onAnswers={onAnswers}
            onSelectedIds={onSelectedIds}
            onClear={onClearConversation}
          />
        </div>
      ) : (
        <div className="workspace-body">
          {pane === "overview" ? (
            <OverviewPane
              view={view}
              reports={reports}
              financialView={financialView}
              onFinancialView={setFinancialView}
              onOpenAbout={onOpenAbout}
            />
          ) : null}
          {pane === "financials" ? <FinancialsPane view={view} reports={reports} /> : null}
          {pane === "scenarios" ? (
            <WhatIfPanel
              scenario={scenario}
              inputs={scenarioInputs}
              onChange={(inputs) => setScenarioByReport((current) => ({ ...current, [reportKey]: inputs }))}
              onReset={() => setScenarioByReport((current) => ({ ...current, [reportKey]: resetScenarioInputs() }))}
            />
          ) : null}
          {pane === "evidence" ? (
            <EvidencePane
              view={view}
              research={research}
              events={events}
              observations={observations}
              pending={pending}
            />
          ) : null}
          {pane === "ask" ? (
            <AskPane
              context={askWithScenario}
              answers={answers}
              selectedIds={selectedIds}
              onAnswers={onAnswers}
              onSelectedIds={onSelectedIds}
              onClear={onClearConversation}
            />
          ) : null}
        </div>
      )}

      {pane === "overview" ? (
        <WhatChangedPanel
          view={view}
          reports={reports}
          pending={pending}
          research={research}
          events={events}
          observations={observations}
          hospitalName={title}
          onOpenChart={(id) => {
            setFinancialView(id);
            window.requestAnimationFrame(() => {
              document.getElementById("financial-chart-region")?.focus();
            });
          }}
        />
      ) : null}
    </section>
  );
}
