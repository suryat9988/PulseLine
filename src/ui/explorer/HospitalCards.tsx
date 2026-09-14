import { useRef } from "react";
import { MEASURES } from "../../../lib/finance/index.ts";
import { clampIndex, type ExplorerHospital } from "../../../lib/explorer/index.ts";
import { StatusGlyph } from "../hospital-display.tsx";
import { money, statusClass } from "../format.ts";

const CARD_METRIC_TIPS = {
  net_patient_revenue: {
    meaning: "Money this hospital reported earning from patient care in the latest fiscal report, after usual billing adjustments.",
    caveat: "Not every dollar the hospital took in, and not a price or valuation.",
  },
  patient_service_expenses: {
    meaning: "What this hospital reported spending to provide patient care in that same fiscal report.",
    caveat: "Not a complete operating-cost total, and not the same as cash paid out.",
  },
  cash: {
    meaning: "Cash the hospital reported on hand and in banks at the end of that fiscal report.",
    caveat: "A snapshot only — not how long the cash will last, and not checked for restricted funds.",
  },
} as const;

function CardMetric({
  measureId,
  value,
}: {
  measureId: keyof typeof CARD_METRIC_TIPS;
  value: number | null;
}) {
  const measure = MEASURES[measureId];
  const tip = CARD_METRIC_TIPS[measureId];
  const tipId = `card-metric-${measureId}`;
  return (
    <div className="card-metric" tabIndex={0} aria-describedby={tipId}>
      <dt>{measure.label}</dt>
      <dd>{money(value)}</dd>
      <p id={tipId} className="card-metric-tip" role="tooltip">
        {tip.meaning} {tip.caveat}
      </p>
    </div>
  );
}

export interface HospitalCardModel {
  hospital: ExplorerHospital;
  netPatientRevenue: number | null;
  expenses: number | null;
  cash: number | null;
}

export function HospitalCards({
  cards,
  visibleIndex,
  selectedId,
  onVisibleIndex,
  onViewFinancials,
  onOpenList,
}: {
  cards: HospitalCardModel[];
  visibleIndex: number;
  selectedId: string | null;
  onVisibleIndex: (index: number) => void;
  onViewFinancials: (hospitalId: string) => void;
  onOpenList: () => void;
}) {
  const startX = useRef<number | null>(null);
  const index = clampIndex(visibleIndex, cards.length);
  const card = cards[index] ?? null;
  if (!card) {
    return (
      <div className="empty-copy">
        <p>No matching hospitals in PulseLine.</p>
        <p className="tiny">This does not mean no hospitals exist there. PulseLine only includes the current dataset.</p>
      </div>
    );
  }
  const hospital = card.hospital;
  const selected = hospital.hospitalId === selectedId;
  const pending = hospital.financialStatus === "pending";

  function move(next: number) {
    onVisibleIndex(clampIndex(next, cards.length));
  }

  return (
    <section className="hospital-cards" aria-label="Matching hospitals">
      <div className="card-nav">
        <button type="button" className="card-arrow" aria-label="Previous hospital" disabled={index === 0} onClick={() => move(index - 1)}>
          ←
        </button>
        <p className="card-position">
          {index + 1} of {cards.length}
        </p>
        <button
          type="button"
          className="card-arrow"
          aria-label="Next hospital"
          disabled={index >= cards.length - 1}
          onClick={() => move(index + 1)}
        >
          →
        </button>
      </div>
      <article
        className={`browse-card ${selected ? "is-selected" : ""}`}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            move(index - 1);
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            move(index + 1);
          }
        }}
        onTouchStart={(event) => {
          startX.current = event.changedTouches[0]?.clientX ?? null;
        }}
        onTouchEnd={(event) => {
          const start = startX.current;
          const end = event.changedTouches[0]?.clientX;
          startX.current = null;
          if (start == null || end == null) return;
          const delta = end - start;
          if (delta > 48) move(index - 1);
          if (delta < -48) move(index + 1);
        }}
        tabIndex={0}
      >
        <p className="tiny">{selected ? "Selected hospital" : "Browsing card"}</p>
        <h3>{hospital.name}</h3>
        <p className="tiny">
          {[hospital.city, hospital.county ? `${hospital.county} County` : null, hospital.zip].filter(Boolean).join(" · ") ||
            "Location pending"}
        </p>
        <p>Latest fiscal period: {hospital.latestFiscalPeriod ?? "Pending"}</p>
        {pending ? (
          <p className="status-pill status-pending">
            <StatusGlyph status="pending" />
            Financial data pending
          </p>
        ) : (
          <dl className="card-metrics">
            <CardMetric measureId="net_patient_revenue" value={card.netPatientRevenue} />
            <CardMetric measureId="patient_service_expenses" value={card.expenses} />
            <CardMetric measureId="cash" value={card.cash} />
          </dl>
        )}
        <p className="tiny">Coverage: {hospital.dataCoverage === "pending" ? "Pending" : hospital.dataCoverage}</p>
        {!pending && hospital.financialStatus !== "pending" ? (
          <p className={`status-pill ${statusClass(hospital.financialStatus)}`}>
            <StatusGlyph status={hospital.financialStatus} />
            Experimental {hospital.score ?? "none"} · {hospital.financialStatus}
          </p>
        ) : null}
        <button type="button" className="btn-primary" onClick={() => onViewFinancials(hospital.hospitalId)}>
          View financials
        </button>
      </article>
      <button type="button" className="text-link" onClick={onOpenList}>
        View all {cards.length} results
      </button>
    </section>
  );
}

export function ResultsList({
  cards,
  selectedId,
  onViewFinancials,
  onClose,
}: {
  cards: HospitalCardModel[];
  selectedId: string | null;
  onViewFinancials: (hospitalId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="results-list" role="region" aria-label="All matching hospitals">
      <div className="results-list-head">
        <h3>All matching hospitals</h3>
        <button type="button" className="chip" onClick={onClose}>
          Close list
        </button>
      </div>
      <ul className="selector-list">
        {cards.map((card) => (
          <li key={card.hospital.hospitalId}>
            <button
              type="button"
              className={card.hospital.hospitalId === selectedId ? "selector-row is-selected" : "selector-row"}
              onClick={() => onViewFinancials(card.hospital.hospitalId)}
            >
              <span>
                <strong>{card.hospital.name}</strong>
                <span className="tiny">
                  {card.hospital.latestFiscalPeriod ?? "Financial data pending"}
                </span>
              </span>
              <span className="tiny">{card.hospital.county ? `${card.hospital.county} County` : "County pending"}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
