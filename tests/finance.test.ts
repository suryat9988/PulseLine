import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { loadResearchDashboard } from "../lib/pipeline.ts";
import {
  comparableChange,
  compareTwoReports,
  currentRatioValue,
  EDITORIAL_CARD_ORDER,
  financialStatement,
  formatWhatChangedAnswer,
  guidedBrief,
  liabilitiesToAssetsValue,
  measureValue,
  MEASURES,
  patientServiceReconcile,
  periodAgeDays,
  periodMeta,
  periodsOverlap,
  priorReport,
  relativeChangeForUnit,
  safePercentChange,
  whatChangedBrief,
} from "../lib/finance/index.ts";
import { evaluateScenario, resetScenarioInputs } from "../lib/scenario/whatif.ts";
import { buildScoreRubric } from "../lib/score-rubric.ts";
import { adaptEvidencePack } from "../lib/adapt-evidence.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const researchPack = JSON.parse(readFileSync(join(root, "research", "PulseLine_three_hospital_data.json"), "utf8"));
const evidencePack = JSON.parse(readFileSync(join(root, "research", "PulseLine_expanded_evidence_v1.json"), "utf8"));
const loaded = loadResearchDashboard(researchPack);
const evidence = adaptEvidencePack(evidencePack);

function facility(name: string) {
  const found = loaded.facilities.find((item) => item.name.includes(name));
  assert.ok(found);
  return found;
}

describe("source-to-display financial mapping", () => {
  it("maps CMS fields without treating missing as zero", () => {
    const river = facility("Kentucky River");
    const npr = measureValue(river.latest, "net_patient_revenue");
    assert.equal(npr.origin, "source_reported");
    assert.equal(npr.value, river.latest.hospital.financials.netPatientRevenue);
    assert.notEqual(npr.value, null);
    const missing = measureValue(
      {
        ...river.latest,
        hospital: { ...river.latest.hospital, financials: { ...river.latest.hospital.financials, cash: null } },
      },
      "cash",
    );
    assert.equal(missing.value, null);
    assert.notEqual(missing.value, 0);
    assert.match(missing.exclusion ?? "", /Missing/);
  });

  it("preserves negative values and excludes uninterpretable ratios", () => {
    const river = facility("Kentucky River");
    const cashPoints = river.reports.map((report) => report.hospital.financials.cash);
    assert.ok(cashPoints.some((value) => value !== null && value < 0));
    const morgan = facility("Morgan");
    const current = currentRatioValue(morgan.latest.hospital);
    const leverage = liabilitiesToAssetsValue(morgan.latest.hospital);
    assert.equal(current.excluded || leverage.excluded, true);
    assert.equal(current.value === null || leverage.value === null, true);
  });

  it("keeps publication dates separate from fiscal periods", () => {
    const breck = facility("Breckinridge");
    const meta = periodMeta(breck.latest, new Date("2026-09-12T00:00:00Z"));
    assert.match(breck.latest.hospital.fiscalYearEnd, /^\d{4}-\d{2}-\d{2}$/);
    assert.notEqual(String(breck.latest.hospital.fileCohort), breck.latest.hospital.fiscalYearEnd);
    assert.equal(meta.publicationStatus, breck.latest.hospital.publicationDate ? "verified_date" : "unverified");
    assert.match(meta.publicationLabel, /publication date/i);
    assert.match(meta.historicalNote, /not current/i);
    assert.ok((periodAgeDays(breck.latest.hospital.fiscalYearEnd, new Date("2026-09-12T00:00:00Z")) ?? 0) > 0);
  });
});

describe("fiscal-period comparability and safe percentages", () => {
  it("does not invent a percent change from missing or zero baselines", () => {
    assert.equal(safePercentChange(10, null), null);
    assert.equal(safePercentChange(null, 10), null);
    assert.equal(safePercentChange(10, 0), null);
    assert.equal(safePercentChange(12, 10), 20);
    assert.equal(safePercentChange(8, -10), null);
    assert.equal(relativeChangeForUnit(0.2, 0.15, "percent").kind, "percentage_points");
    assert.ok(Math.abs((relativeChangeForUnit(0.2, 0.15, "percent").value ?? 0) - 5) < 1e-10);
    assert.equal(relativeChangeForUnit(1.4, 1.1, "ratio").kind, "ratio_points");
    assert.ok(Math.abs((relativeChangeForUnit(1.4, 1.1, "ratio").value ?? 0) - 0.3) < 1e-10);
    assert.equal(relativeChangeForUnit(12, 10, "usd").kind, "percent");
    assert.equal(relativeChangeForUnit(12, 0, "usd").kind, "absolute_only");
    assert.equal(relativeChangeForUnit(12, -4, "usd").kind, "absolute_only");
  });

  it("withholds an unqualified growth rate when periods overlap or lengths differ", () => {
    const breck = facility("Breckinridge");
    const [first, second] = breck.reports;
    assert.ok(first && second);
    const overlap = {
      ...second,
      hospital: {
        ...second.hospital,
        fiscalYearStart: first.hospital.fiscalYearStart,
        fiscalYearEnd: first.hospital.fiscalYearEnd,
      },
    };
    assert.equal(periodsOverlap(first, overlap), true);
    const blocked = compareTwoReports(overlap, first, "net_patient_revenue");
    assert.equal(blocked.comparable, false);
    assert.equal(blocked.state, "incompatible");
    const stretched = {
      ...second,
      hospital: { ...second.hospital, periodDays: 180 },
    };
    const duration = comparableChange(
      stretched,
      { ...first, hospital: { ...first.hospital, periodDays: 400 } },
      20,
      10,
      "net_patient_revenue",
    );
    assert.equal(duration.percent, null);
    assert.equal(duration.comparable, false);
    assert.equal(duration.state, "incompatible");
  });

  it("uses comparable, limited, and incompatible states without claiming missing lengths are verified", () => {
    const breck = facility("Breckinridge");
    const previous = priorReport(breck.reports, breck.latest);
    assert.ok(previous);
    const valid = compareTwoReports(breck.latest, previous, "net_patient_revenue");
    assert.equal(valid.state, "comparable");
    assert.equal(valid.comparable, true);
    assert.equal(valid.permitsRelativeChange, true);
    assert.match(valid.note, /same CMS measure|two-report|successive/i);
    assert.ok(!/cannot verify that these periods are within 30 days/i.test(valid.note));

    const missingDays = compareTwoReports(
      withFinancials(breck.latest, { periodDays: null }),
      withFinancials(previous, { periodDays: null }),
      "net_patient_revenue",
    );
    assert.equal(missingDays.state, "limited");
    assert.equal(missingDays.comparable, false);
    assert.equal(missingDays.permitsRelativeChange, false);
    assert.match(missingDays.note, /missing/i);
    assert.ok(!/within 30 days of each other\./i.test(missingDays.note) || /cannot verify/i.test(missingDays.note));

    const scopeClash = compareTwoReports(
      withFinancials(breck.latest, { reportingScope: "facility" }),
      withFinancials(previous, { reportingScope: "parent" }),
      "net_patient_revenue",
    );
    assert.equal(scopeClash.state, "incompatible");
    assert.equal(scopeClash.comparable, false);
    assert.equal(scopeClash.permitsRelativeChange, false);
    assert.match(scopeClash.note, /facility and parent|scopes differ/i);

    const unknownScope = compareTwoReports(
      withFinancials(breck.latest, { reportingScope: null }),
      withFinancials(previous, { reportingScope: null }),
      "net_patient_revenue",
    );
    assert.equal(unknownScope.state, "limited");
    assert.equal(unknownScope.permitsRelativeChange, true);
    assert.match(unknownScope.note, /not verified same-entity|not independently reconciled/i);
  });
});

describe("financial statements and guided brief", () => {
  it("labels source-reported versus calculated rows and does not invent a complete statement", () => {
    const breck = facility("Breckinridge");
    const statement = financialStatement(breck.reports);
    assert.ok(statement.rows.some((row) => row.origin === "source_reported" && row.id === "net_patient_revenue"));
    assert.ok(statement.rows.some((row) => row.origin === "calculated" && row.id === "derived_patient_service_balance"));
    assert.ok(!statement.rows.some((row) => /ebitda|enterprise value/i.test(row.label)));
    const reconcile = patientServiceReconcile(breck.latest.hospital);
    if (reconcile.published !== null && reconcile.derived !== null) {
      assert.equal(typeof reconcile.note, "string");
    }
  });

  it("writes a deterministic brief from supported comparisons", () => {
    const morgan = facility("Morgan");
    const brief = guidedBrief(morgan.latest, morgan.reports, new Date("2026-09-12T00:00:00Z"));
    assert.ok(brief.records.some((line) => /Net patient revenue/i.test(line.text)));
    assert.ok(brief.changes.length > 0);
    assert.match(brief.exploratoryRule, /exploratory/);
    assert.ok(!brief.records.some((line) => /overall financial health/i.test(line.text)));
  });
});

describe("scenario isolation and research cases", () => {
  it("keeps historical records and scores unchanged after a scenario", () => {
    const item = facility("Breckinridge");
    const beforeScore = item.latest.financial.score;
    const beforeRevenue = item.latest.hospital.financials.netPatientRevenue;
    const shocked = evaluateScenario(item.latest, { revenueChangePct: 20, expenseChangePct: -8 });
    assert.equal(shocked.enabled, true);
    assert.equal(item.latest.financial.score, beforeScore);
    assert.equal(item.latest.hospital.financials.netPatientRevenue, beforeRevenue);
    const rubric = buildScoreRubric(item.latest.financial);
    assert.equal(rubric.roundedScore, item.latest.financial.score);
  });

  it("does not enable a financial model for research cases", () => {
    const research = evidence.ledger?.hospitals.find((item) => item.name.includes("Highlands"));
    assert.ok(research);
    const pending = evaluateScenario(null, resetScenarioInputs(), { pending: true, hospitalName: research.name });
    assert.equal(pending.enabled, false);
    assert.match(pending.disabledReason ?? "", /pending/i);
  });
});

describe("measure catalog", () => {
  it("documents the implemented financial definitions", () => {
    assert.equal(MEASURES.net_patient_revenue.cmsField, "Net Patient Revenue");
    assert.match(MEASURES.patient_service_result_ratio.not, /operating margin/i);
    assert.match(MEASURES.derived_patient_service_balance.not, /cash flow/i);
  });
});

function withFinancials(view: ReturnType<typeof facility>["latest"], patch: Partial<ReturnType<typeof facility>["latest"]["hospital"]["financials"]> & {
  fiscalYearEnd?: string;
  fiscalYearStart?: string | null;
  periodDays?: number | null;
  reportRecordId?: string | null;
  reportingScope?: string | null;
}) {
  const { fiscalYearEnd, fiscalYearStart, periodDays, reportRecordId, reportingScope, ...financials } = patch;
  return {
    ...view,
    hospital: {
      ...view.hospital,
      fiscalYearEnd: fiscalYearEnd ?? view.hospital.fiscalYearEnd,
      fiscalYearStart: fiscalYearStart ?? view.hospital.fiscalYearStart,
      periodDays: periodDays === undefined ? view.hospital.periodDays : periodDays,
      reportRecordId: reportRecordId === undefined ? view.hospital.reportRecordId : reportRecordId,
      reportingScope: reportingScope === undefined ? view.hospital.reportingScope : reportingScope,
      financials: { ...view.hospital.financials, ...financials },
    },
  };
}

describe("What changed structured brief", () => {
  it("compares the selected report with the immediately preceding available report", () => {
    const breck = facility("Breckinridge");
    const selected = breck.latest;
    const previous = priorReport(breck.reports, selected);
    assert.ok(previous);
    const brief = whatChangedBrief({ view: selected, reports: breck.reports, hospitalName: breck.name });
    assert.equal(brief.status, "ready");
    assert.equal(brief.previousPeriod?.end, previous.hospital.fiscalYearEnd);
    assert.equal(brief.currentPeriod?.end, selected.hospital.fiscalYearEnd);
    assert.ok(brief.defaultCards.length <= 3);
    assert.equal(brief.defaultCards[0]?.slot, "revenue_expense_growth");
    const slotIndexes = brief.defaultCards.map((card) => EDITORIAL_CARD_ORDER.indexOf(card.slot as (typeof EDITORIAL_CARD_ORDER)[number]));
    assert.ok(slotIndexes.every((value, index, list) => value >= 0 && (index === 0 || value > list[index - 1]!)));
  });

  it("does not skip to another report when periods overlap or lengths differ", () => {
    const breck = facility("Breckinridge");
    const previous = priorReport(breck.reports, breck.latest);
    assert.ok(previous);
    const overlap = withFinancials(breck.latest, {
      fiscalYearStart: previous.hospital.fiscalYearStart,
    });
    const overlapBrief = whatChangedBrief({
      view: overlap,
      reports: [previous, overlap],
      hospitalName: "Overlap hospital",
    });
    assert.equal(overlapBrief.previousPeriod?.end, previous.hospital.fiscalYearEnd);
    assert.equal(overlapBrief.comparable, false);
    assert.equal(overlapBrief.comparability?.state, "incompatible");
    assert.match(overlapBrief.comparability?.note ?? "", /overlap/i);
    assert.match(formatWhatChangedAnswer(overlapBrief).statement, /not comparable/i);
    assert.ok(overlapBrief.defaultCards.length > 0);

    const stretched = withFinancials(breck.latest, { periodDays: 180 });
    const short = withFinancials(previous, { periodDays: 400 });
    const durationBrief = whatChangedBrief({
      view: stretched,
      reports: [short, stretched],
      hospitalName: "Duration hospital",
    });
    assert.equal(durationBrief.comparable, false);
    assert.equal(durationBrief.comparability?.state, "incompatible");
    assert.equal(durationBrief.previousPeriod?.end, short.hospital.fiscalYearEnd);
    assert.match(durationBrief.comparability?.note ?? "", /30 days/i);

    const missingLength = whatChangedBrief({
      view: withFinancials(breck.latest, { periodDays: null }),
      reports: [withFinancials(previous, { periodDays: null }), withFinancials(breck.latest, { periodDays: null })],
      hospitalName: "Missing length hospital",
    });
    assert.equal(missingLength.comparability?.state, "limited");
    assert.match(formatWhatChangedAnswer(missingLength).statement, /Limited comparison/i);
    assert.match(formatWhatChangedAnswer(missingLength).limitations.join(" "), /cannot verify/i);

    const unknownScope = whatChangedBrief({
      view: withFinancials(breck.latest, { reportingScope: null }),
      reports: [withFinancials(previous, { reportingScope: null }), withFinancials(breck.latest, { reportingScope: null })],
      hospitalName: "Unknown scope hospital",
    });
    assert.equal(unknownScope.comparability?.state, "limited");
    assert.match(formatWhatChangedAnswer(unknownScope).statement, /Limited comparison|not verified same-entity|not independently reconciled/i);
    assert.ok(unknownScope.defaultCards.some((card) => card.relativeLabel != null || card.absoluteLabel != null));
  });

  it("flags duplicate or revised report records without inventing a substitute pair", () => {
    const breck = facility("Breckinridge");
    const earlier = priorReport(breck.reports, breck.latest);
    assert.ok(earlier);
    const previous = withFinancials(earlier, { reportRecordId: "shared-cms-record" });
    const revised = withFinancials(breck.latest, { reportRecordId: "shared-cms-record" });
    const brief = whatChangedBrief({
      view: revised,
      reports: [previous, revised],
      hospitalName: breck.name,
    });
    assert.equal(brief.comparable, false);
    assert.match(brief.comparability?.note ?? "", /report record/i);
    assert.equal(brief.previousPeriod?.end, previous.hospital.fiscalYearEnd);
  });

  it("describes revenue and expense growth rates without treating dollar change as the growth comparison", () => {
    const breck = facility("Breckinridge");
    const earlier = priorReport(breck.reports, breck.latest);
    assert.ok(earlier);
    const previous = withFinancials(earlier, { netPatientRevenue: 100, operatingExpenses: 80 });
    const current = withFinancials(breck.latest, { netPatientRevenue: 110, operatingExpenses: 100 });
    const brief = whatChangedBrief({
      view: current,
      reports: [previous, current],
      hospitalName: breck.name,
    });
    const growth = brief.allCards.find((card) => card.id === "card:revenue_expense_growth");
    assert.ok(growth);
    assert.match(growth.explanation, /Expenses increased faster than net patient revenue/);
    assert.match(growth.explanation, /not the same as the dollar change/i);
    assert.ok(!growth.explanation.includes("failing"));
    assert.ok(!growth.explanation.includes("will be acquired"));
  });

  it("does not substitute overall operating margin for a patient-service result", () => {
    const breck = facility("Breckinridge");
    const brief = whatChangedBrief({
      view: breck.latest,
      reports: breck.reports,
      hospitalName: breck.name,
    });
    const result = brief.defaultCards.find((card) => card.slot === "patient_service_result");
    if (result) {
      assert.ok(!/operating margin/i.test(result.title));
      assert.match(result.explanation, /not overall operating/i);
    }
    const ratio = brief.allCards.find((card) => card.measureIds.includes("patient_service_result_ratio"));
    if (ratio) {
      assert.ok(!brief.defaultCards.some((card) => card.id === ratio.id));
    }
  });

  it("avoids three default cards that restate the same underlying change", () => {
    const breck = facility("Breckinridge");
    const brief = whatChangedBrief({
      view: breck.latest,
      reports: breck.reports,
      hospitalName: breck.name,
    });
    const slots = brief.defaultCards.map((card) => card.slot);
    assert.equal(new Set(slots).size, slots.length);
    assert.ok(!brief.defaultCards.some((card) => card.id === "card:net_patient_revenue"));
    assert.ok(!brief.defaultCards.some((card) => card.id === "card:patient_service_expenses"));
    const hasPublished = brief.defaultCards.some((card) => card.measureIds.includes("published_patient_service_result"));
    const hasDerived = brief.defaultCards.some((card) => card.measureIds.includes("derived_patient_service_balance"));
    assert.equal(hasPublished && hasDerived, false);
  });

  it("does not generate change cards for research cases with financial data pending", () => {
    const pending = whatChangedBrief({
      view: null,
      reports: [],
      pending: true,
      hospitalName: "Paul B. Hall Regional Medical Center",
    });
    assert.equal(pending.status, "pending");
    assert.equal(pending.defaultCards.length, 0);
    assert.equal(pending.allCards.length, 0);
    assert.match(pending.pendingReason ?? "", /Financial data pending/);
    assert.ok(pending.recordsNeeded.length > 0);
    const highlands = whatChangedBrief({
      view: null,
      reports: [],
      pending: true,
      hospitalName: "Highlands Regional Medical Center",
    });
    assert.equal(highlands.allCards.length, 0);
  });

  it("keeps guided brief text and Ask formatting on the same structured results", () => {
    const morgan = facility("Morgan");
    const brief = whatChangedBrief({
      view: morgan.latest,
      reports: morgan.reports,
      hospitalName: morgan.name,
      asOf: new Date("2026-09-12T00:00:00Z"),
    });
    const guided = guidedBrief(morgan.latest, morgan.reports, new Date("2026-09-12T00:00:00Z"));
    assert.deepEqual(guided.changes.map((line) => line.id), brief.changes.map((line) => line.id));
    const formatted = formatWhatChangedAnswer(brief);
    for (const card of brief.defaultCards) {
      assert.ok(formatted.statement.includes(card.title));
      assert.ok(formatted.statement.includes(card.previousExact));
      assert.ok(formatted.statement.includes(card.currentExact));
    }
    assert.ok(formatted.limitations.includes(brief.limitations[0] ?? ""));
  });
});
