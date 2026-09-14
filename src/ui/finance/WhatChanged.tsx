import { useId, useState } from "react";
import type { FinancialViewId } from "../../../lib/charts/views.ts";
import { briefEvidenceGaps, EMPTY_EVENT_LEDGER, GAP_KIND_LABELS } from "../../../lib/diligence/gaps.ts";
import { whatChangedBrief, type ChangeCard, type WhatChangedBrief } from "../../../lib/finance/index.ts";
import type { EvidenceHospital, EvidenceObservation, HospitalView, StructuralEvent } from "../../types.ts";
import { EventTimeline } from "../EventTimeline.tsx";

function directionSymbol(direction: ChangeCard["direction"]): string {
  if (direction === "up") return "↑";
  if (direction === "down") return "↓";
  if (direction === "flat") return "→";
  return "·";
}

function directionText(direction: ChangeCard["direction"]): string {
  if (direction === "up") return "Increased";
  if (direction === "down") return "Decreased";
  if (direction === "flat") return "Unchanged";
  return "Not compared";
}

function ChangeCardView({
  card,
  previousLabel,
  currentLabel,
  onOpenChart,
}: {
  card: ChangeCard;
  previousLabel: string;
  currentLabel: string;
  onOpenChart: (id: FinancialViewId) => void;
}) {
  return (
    <article className={`change-card is-${card.direction}`}>
      <header className="change-card-head">
        <h3>{card.title}</h3>
        <p className="change-direction">
          <span aria-hidden="true">{directionSymbol(card.direction)}</span>
          <span>{directionText(card.direction)}</span>
        </p>
      </header>
      <p className="change-values">
        <span>
          <span className="label">{previousLabel}</span>
          <strong>{card.previousDisplay}</strong>
        </span>
        <span className="change-arrow" aria-hidden="true">
          →
        </span>
        <span>
          <span className="label">{currentLabel}</span>
          <strong>{card.currentDisplay}</strong>
        </span>
      </p>
      <p className="change-deltas">
        {card.absoluteLabel ? <span>Absolute change {card.absoluteLabel}</span> : null}
        {card.relativeLabel ? <span>{card.relativeLabel}</span> : <span>Percentage change not calculated</span>}
      </p>
      <p>{card.explanation}</p>
      <div className="change-card-actions">
        <details>
          <summary>Source and details</summary>
          <p className="tiny">{card.originNote}</p>
          <ul className="brief-list">
            {card.details.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <ul className="tiny">
            {card.sources.map((source) => (
              <li key={`${source.label}:${source.reportId ?? ""}`}>
                {source.url ? (
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {source.label}
                  </a>
                ) : (
                  source.label
                )}
                {source.reportId ? ` · Report ${source.reportId}` : ""}
              </li>
            ))}
          </ul>
          {card.limitation ? <p className="tiny">{card.limitation}</p> : null}
        </details>
        <button type="button" className="chip" onClick={() => onOpenChart(card.chartView)}>
          {card.chartActionLabel}
        </button>
      </div>
    </article>
  );
}

function ReliancePanel({
  brief,
  view,
  research,
  events,
  observations,
  pending,
}: {
  brief: WhatChangedBrief;
  view: HospitalView | null;
  research: EvidenceHospital | null;
  events: StructuralEvent[];
  observations: EvidenceObservation[];
  pending: boolean;
}) {
  const durationStatus = brief.comparability?.checks.find((check) => check.id === "duration")?.status;
  const overlap = brief.comparability?.checks.find((check) => check.id === "overlap")?.status === "fail";
  const displayedMissing = brief.allCards
    .filter((card) => card.previousRaw === null || card.currentRaw === null)
    .map((card) => card.title);
  const grouped = briefEvidenceGaps({
    view,
    research,
    events,
    observations,
    pending,
    comparable: brief.comparable,
    durationStatus,
    overlapOrDuplicate: overlap,
    publicationUnverified: view ? view.hospital.publicationDate == null : true,
    displayedMissing,
  });
  const compact = grouped.priority.slice(0, 4);
  const caveatCount = grouped.priority.length + grouped.additional.length;
  const summaryHint =
    caveatCount === 0 ? "Open if you need the caveats" : `${caveatCount} ${caveatCount === 1 ? "caveat" : "caveats"}`;
  return (
    <details className="reliance-panel">
      <summary>
        <h3 id="reliance-title">Before relying on these figures</h3>
        <span className="tiny">{summaryHint}</span>
      </summary>
      <div className="reliance-body">
        <p className="tiny">
          Generated from the selected records. Fiscal-end age is not a publication date. Unknown publication dates
          limit point-in-time claims; they do not block labeled retrospective viewing.
        </p>
        {compact.length === 0 ? (
          <p className="tiny">No finding-specific gaps were generated for this comparison.</p>
        ) : (
          <ul className="reliance-list">
            {compact.map((gap) => (
              <li key={gap.id}>
                <span className="label">{GAP_KIND_LABELS[gap.kind]}</span>
                <strong>{gap.label}</strong>
                <p className="tiny">{gap.detail}</p>
              </li>
            ))}
          </ul>
        )}
        {grouped.additional.length > 0 || grouped.priority.length > compact.length ? (
          <details className="reliance-more">
            <summary>More evidence gaps</summary>
            <ul className="reliance-list">
              {[...grouped.priority.slice(compact.length), ...grouped.additional].map((gap) => (
                <li key={gap.id}>
                  <span className="label">{GAP_KIND_LABELS[gap.kind]}</span>
                  <strong>{gap.label}</strong>
                  <p className="tiny">{gap.detail}</p>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </details>
  );
}

export function WhatChangedPanel({
  view,
  reports,
  pending,
  research,
  events,
  observations,
  hospitalName,
  onOpenChart,
}: {
  view: HospitalView | null;
  reports: HospitalView[];
  pending: boolean;
  research: EvidenceHospital | null;
  events: StructuralEvent[];
  observations: EvidenceObservation[];
  hospitalName: string;
  onOpenChart: (id: FinancialViewId) => void;
}) {
  const headingId = useId();
  const [showAll, setShowAll] = useState(false);
  const brief = whatChangedBrief({ view, reports, pending, hospitalName });
  const previousLabel = brief.previousPeriod?.label ?? "Earlier report";
  const currentLabel = brief.currentPeriod?.label ?? "Selected report";
  const cards = showAll ? brief.allCards : brief.defaultCards;

  if (brief.status === "pending") {
    return (
      <section className="what-changed" aria-labelledby={headingId}>
        <div className="what-changed-copy">
          <h3 id={headingId}>What changed?</h3>
          <p className="status-pill status-pending">Financial data pending</p>
          <p>{brief.pendingReason}</p>
          <p>No change cards, financial scores, or comparisons were generated.</p>
          <h4>Records needed before financial analysis</h4>
          <ul className="brief-list">
            {brief.recordsNeeded.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div className="what-changed-side">
          <h4>Sourced events remain available</h4>
          {events.length > 0 ? <EventTimeline events={events} /> : <p className="tiny">{EMPTY_EVENT_LEDGER}</p>}
          <ReliancePanel
            brief={brief}
            view={view}
            research={research}
            events={events}
            observations={observations}
            pending={pending}
          />
        </div>
      </section>
    );
  }

  return (
    <section className="what-changed" aria-labelledby={headingId}>
      <div className="what-changed-copy">
        <h3 id={headingId}>What changed?</h3>
        <p className="what-changed-periods">
          {brief.previousPeriod ? (
            <>
              Comparing <strong>{previousLabel}</strong> with selected <strong>{currentLabel}</strong>. Both reporting
              periods are shown.
            </>
          ) : (
            <>
              Selected period <strong>{currentLabel}</strong>. No earlier fiscal report is available for a comparison.
            </>
          )}
        </p>
        {brief.comparability && brief.comparability.state !== "comparable" ? (
          <p className="tiny">
            {brief.comparability.state === "incompatible" ? "These reports are not comparable. " : "Limited comparison. "}
            {brief.comparability.note}
          </p>
        ) : null}
        {cards.length === 0 ? (
          <p>{brief.changes[0]?.text ?? "No supported comparison is available."}</p>
        ) : (
          <div className="change-card-grid">
            {cards.map((card) => (
              <ChangeCardView
                key={card.id}
                card={card}
                previousLabel={previousLabel}
                currentLabel={currentLabel}
                onOpenChart={onOpenChart}
              />
            ))}
          </div>
        )}
        {brief.remainingCards.length > 0 ? (
          <button type="button" className="chip" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>
            {showAll ? "Show default changes" : `View all changes (${brief.remainingCards.length} more)`}
          </button>
        ) : null}
        <p className="tiny">{brief.editorialRule}</p>
      </div>
      <ReliancePanel
        brief={brief}
        view={view}
        research={research}
        events={events}
        observations={observations}
        pending={pending}
      />
    </section>
  );
}
