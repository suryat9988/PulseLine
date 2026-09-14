import type { FinancialViewId } from "../charts/views.ts";
import type { HospitalView } from "../../src/types.ts";
import { moneyExact } from "../../src/ui/format.ts";
import {
  comparabilityCaption,
  compareTwoReports,
  EXPLORATORY_CHANGE_PCT,
  EXPLORATORY_CHANGE_RULE,
  orderedReports,
  percentChangeNote,
  safePercentChange,
  type ComparabilityCheck,
  type ComparabilityResult,
} from "./comparability.ts";
import { MEASURES, measureValue, patientServiceReconcile, type MeasureId, type MeasureUnit } from "./measures.ts";
import { periodMeta } from "./period.ts";

export const EDITORIAL_CARD_ORDER = [
  "revenue_expense_growth",
  "patient_service_result",
  "liquidity",
  "assets_liabilities",
  "operational",
] as const;

export type EditorialSlot = (typeof EDITORIAL_CARD_ORDER)[number];

export const EDITORIAL_CARD_RULE =
  "Default What changed? cards follow a documented editorial order and data availability: (1) revenue and patient-service expense growth comparison, (2) supported patient-service result or an explicitly derived balance, (3) a liquidity measure, (4) an assets/liabilities measure, (5) operational utilization, labeled operational. PulseLine does not rank raw dollar changes against ratio changes or call the largest numeric change the most material.";

export type RelativeChangeKind = "percent" | "percentage_points" | "ratio_points" | "absolute_only" | "not_calculated";
export type ChangeDirection = "up" | "down" | "flat" | "unavailable";

export interface BriefLine {
  id: string;
  text: string;
  periodLabel: string | null;
}

export interface BriefPeriod {
  start: string | null;
  end: string;
  label: string;
  days: number | null;
}

export interface ChangeCard {
  id: string;
  slot: EditorialSlot | "additional";
  title: string;
  measureIds: MeasureId[];
  previousDisplay: string;
  currentDisplay: string;
  previousExact: string;
  currentExact: string;
  previousRaw: number | null;
  currentRaw: number | null;
  absoluteLabel: string | null;
  relativeLabel: string | null;
  relativeKind: RelativeChangeKind;
  relativeValue: number | null;
  absoluteValue: number | null;
  explanation: string;
  direction: ChangeDirection;
  comparable: boolean;
  limitation: string | null;
  chartView: FinancialViewId;
  chartActionLabel: string;
  originNote: string;
  details: string[];
  sources: { label: string; url: string | null; reportId: string | null }[];
}

export interface WhatChangedBrief {
  status: "ready" | "pending" | "no_prior";
  hospitalName: string;
  currentPeriod: BriefPeriod | null;
  previousPeriod: BriefPeriod | null;
  comparable: boolean;
  comparability: ComparabilityResult | null;
  defaultCards: ChangeCard[];
  remainingCards: ChangeCard[];
  allCards: ChangeCard[];
  records: BriefLine[];
  changes: BriefLine[];
  investigate: BriefLine[];
  limitations: string[];
  sources: { label: string; url: string | null; reportId: string | null }[];
  pendingReason: string | null;
  recordsNeeded: string[];
  editorialRule: string;
  exploratoryRule: string;
}

export interface GuidedBrief {
  records: BriefLine[];
  changes: BriefLine[];
  investigate: BriefLine[];
  exploratoryRule: string;
}

export interface WhatChangedInput {
  view: HospitalView | null;
  reports: HospitalView[];
  pending?: boolean;
  hospitalName?: string;
  asOf?: Date;
}

export function priorReport(reports: HospitalView[], current: HospitalView): HospitalView | null {
  return (
    orderedReports(reports)
      .filter((report) => report.hospital.fiscalYearEnd < current.hospital.fiscalYearEnd)
      .at(-1) ?? null
  );
}

export function periodLabel(view: HospitalView): string {
  const start = view.hospital.fiscalYearStart;
  return start ? `${start} to ${view.hospital.fiscalYearEnd}` : `Ending ${view.hospital.fiscalYearEnd}`;
}

function briefPeriod(view: HospitalView): BriefPeriod {
  return {
    start: view.hospital.fiscalYearStart,
    end: view.hospital.fiscalYearEnd,
    label: periodLabel(view),
    days: view.hospital.periodDays,
  };
}

function moneyPhrase(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)} million`;
  return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
}

function signedMoney(value: number): string {
  const abs = moneyPhrase(Math.abs(value)).replace("−", "");
  if (value > 0) return `+${abs}`;
  if (value < 0) return `−${abs}`;
  return abs;
}

function formatMeasure(id: MeasureId, value: number | null, exact = false): string {
  if (value === null) return "Not available";
  const unit = MEASURES[id].unit;
  if (unit === "usd") return exact ? moneyExact(value) : moneyPhrase(value);
  if (unit === "percent") return `${(value * 100).toFixed(1)}%`;
  if (unit === "ratio") return value.toFixed(2);
  return value.toLocaleString("en-US");
}

function signedNumber(value: number, digits = 1): string {
  const abs = Math.abs(value).toFixed(digits);
  if (value > 0) return `+${abs}`;
  if (value < 0) return `−${abs}`;
  return abs;
}

function directionOf(delta: number | null): ChangeDirection {
  if (delta === null || !Number.isFinite(delta)) return "unavailable";
  if (delta > 0) return "up";
  if (delta < 0) return "down";
  return "flat";
}

function directionWord(direction: ChangeDirection): string {
  if (direction === "up") return "increased";
  if (direction === "down") return "decreased";
  if (direction === "flat") return "was unchanged";
  return "could not be compared";
}

export function relativeChangeForUnit(
  current: number | null,
  previous: number | null,
  unit: MeasureUnit,
): { kind: RelativeChangeKind; value: number | null; note: string | null } {
  if (current === null || previous === null) {
    return {
      kind: "not_calculated",
      value: null,
      note: "A value is missing on one of these reports. Missing is not zero.",
    };
  }
  if (unit === "percent") {
    return { kind: "percentage_points", value: (current - previous) * 100, note: null };
  }
  if (unit === "ratio") {
    return { kind: "ratio_points", value: current - previous, note: null };
  }
  const percent = safePercentChange(current, previous);
  if (percent === null) {
    return { kind: "absolute_only", value: null, note: percentChangeNote(previous) };
  }
  return { kind: "percent", value: percent, note: null };
}

function relativeLabel(kind: RelativeChangeKind, value: number | null): string | null {
  if (value === null) return null;
  if (kind === "percent") return `${signedNumber(value)}%`;
  if (kind === "percentage_points") return `${signedNumber(value)} percentage points`;
  if (kind === "ratio_points") return `${signedNumber(value, 2)} ratio points`;
  return null;
}

function sourceFor(view: HospitalView): { label: string; url: string | null; reportId: string | null } {
  return {
    label: view.hospital.sourceId ?? "CMS cost report",
    url: view.hospital.sourceUrl,
    reportId: view.hospital.reportRecordId,
  };
}

function uniqueSources(views: HospitalView[]): { label: string; url: string | null; reportId: string | null }[] {
  const seen = new Set<string>();
  const sources: { label: string; url: string | null; reportId: string | null }[] = [];
  for (const view of views) {
    const source = sourceFor(view);
    const key = `${source.label}:${source.reportId ?? ""}:${source.url ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(source);
  }
  return sources;
}

function chartMeta(view: FinancialViewId): { chartView: FinancialViewId; chartActionLabel: string } {
  const labels: Record<FinancialViewId, string> = {
    npr_expenses: "Open revenue and patient-service expenses chart",
    patient_service_result: "Open patient-service result chart",
    cash_liquidity: "Open cash and liquidity chart",
    assets_liabilities: "Open assets and liabilities chart",
    current_ratio: "Open current ratio chart",
  };
  return { chartView: view, chartActionLabel: labels[view] };
}

function measureCard(
  current: HospitalView,
  previous: HospitalView,
  id: MeasureId,
  slot: EditorialSlot | "additional",
  title: string,
  chartView: FinancialViewId,
  extraDetails: string[] = [],
): ChangeCard {
  const now = measureValue(current, id);
  const then = measureValue(previous, id);
  const comparability = compareTwoReports(current, previous, id);
  const relative = relativeChangeForUnit(now.value, then.value, MEASURES[id].unit);
  const absolute = now.value !== null && then.value !== null ? now.value - then.value : null;
  const withheldPercent =
    MEASURES[id].unit !== "percent" && MEASURES[id].unit !== "ratio" && !comparability.permitsRelativeChange;
  const kind = withheldPercent && relative.kind === "percent" ? "absolute_only" : relative.kind;
  const relativeValue = kind === "absolute_only" ? null : relative.value;
  const limitationParts = [
    comparability.state !== "comparable" ? comparabilityCaption(comparability) : null,
    relative.note,
    now.exclusion,
    then.exclusion && then.exclusion !== now.exclusion ? then.exclusion : null,
    MEASURES[id].not,
  ].filter((item): item is string => Boolean(item));
  const direction = directionOf(absolute);
  const origin = MEASURES[id].origin === "calculated" ? "Calculated from this report" : "Source-reported CMS field";
  const explanation = buildMeasureExplanation(id, now.value, then.value, direction, kind, relativeValue, absolute, comparability);
  return {
    id: `card:${id}`,
    slot,
    title,
    measureIds: [id],
    previousDisplay: formatMeasure(id, then.value),
    currentDisplay: formatMeasure(id, now.value),
    previousExact: formatMeasure(id, then.value, true),
    currentExact: formatMeasure(id, now.value, true),
    previousRaw: then.value,
    currentRaw: now.value,
    absoluteLabel:
      absolute === null
        ? null
        : MEASURES[id].unit === "usd"
          ? signedMoney(absolute)
          : MEASURES[id].unit === "percent"
            ? `${signedNumber(absolute * 100)} percentage points`
            : MEASURES[id].unit === "ratio"
              ? `${signedNumber(absolute, 2)} ratio points`
              : signedNumber(absolute, 0),
    relativeLabel: relativeLabel(kind, relativeValue),
    relativeKind: kind,
    relativeValue,
    absoluteValue: absolute,
    explanation,
    direction,
    comparable: comparability.permitsRelativeChange && now.value !== null && then.value !== null,
    limitation: limitationParts[0] ?? null,
    ...chartMeta(chartView),
    originNote: `${origin}. ${MEASURES[id].cmsField ? `CMS field: ${MEASURES[id].cmsField}.` : MEASURES[id].definition}`,
    details: [
      `Previous report: ${periodLabel(previous)} · ${formatMeasure(id, then.value, true)}`,
      `Selected report: ${periodLabel(current)} · ${formatMeasure(id, now.value, true)}`,
      comparability.note,
      ...comparability.checks.map((check) => check.detail),
      ...extraDetails,
      MEASURES[id].definition,
      MEASURES[id].not,
    ].filter((item, index, list) => item && list.indexOf(item) === index),
    sources: uniqueSources([previous, current]),
  };
}

function buildMeasureExplanation(
  id: MeasureId,
  current: number | null,
  previous: number | null,
  direction: ChangeDirection,
  kind: RelativeChangeKind,
  relativeValue: number | null,
  absolute: number | null,
  comparability: ComparabilityResult,
): string {
  const label = MEASURES[id].label;
  if (current === null || previous === null) {
    return `${label} cannot be compared because a value is missing. Missing is not zero.`;
  }
  const fromTo = `${formatMeasure(id, previous)} in the earlier report to ${formatMeasure(id, current)} in the selected report`;
  const movement = `${label} ${directionWord(direction)} from ${fromTo}.`;
  const relativeBit =
    kind === "percent" && relativeValue !== null
      ? ` That is a ${signedNumber(relativeValue)}% change between these two reports.`
      : kind === "percentage_points" && relativeValue !== null
        ? ` That is a ${signedNumber(relativeValue)} percentage-point change, not a percentage growth rate.`
        : kind === "ratio_points" && relativeValue !== null
          ? ` That is a ${signedNumber(relativeValue, 2)} ratio-point change.`
          : kind === "absolute_only"
            ? ` ${percentChangeNote(previous) ?? "A percentage change is not shown because it would mislead."}`
            : "";
  const comparableBit =
    comparability.state === "comparable"
      ? " This is a two-report comparison, not a multi-year trend."
      : ` ${comparabilityCaption(comparability)}`;
  const notBit = ` ${MEASURES[id].not}`;
  const cue =
    kind === "percent" &&
    relativeValue !== null &&
    comparability.permitsRelativeChange &&
    Math.abs(relativeValue) >= EXPLORATORY_CHANGE_PCT
      ? ` The change meets PulseLine’s exploratory ${EXPLORATORY_CHANGE_PCT}% display cue.`
      : "";
  return `${movement}${relativeBit}${comparableBit}${notBit}${cue}`.replace(/\s+/g, " ").trim();
}

function growthCard(current: HospitalView, previous: HospitalView): ChangeCard | null {
  const nprNow = measureValue(current, "net_patient_revenue");
  const nprThen = measureValue(previous, "net_patient_revenue");
  const expNow = measureValue(current, "patient_service_expenses");
  const expThen = measureValue(previous, "patient_service_expenses");
  if (nprNow.value === null && nprThen.value === null && expNow.value === null && expThen.value === null) {
    return null;
  }
  const comparability = compareTwoReports(current, previous, "net_patient_revenue");
  const nprAbs = nprNow.value !== null && nprThen.value !== null ? nprNow.value - nprThen.value : null;
  const expAbs = expNow.value !== null && expThen.value !== null ? expNow.value - expThen.value : null;
  const nprPct = comparability.permitsRelativeChange ? safePercentChange(nprNow.value, nprThen.value) : null;
  const expPct = comparability.permitsRelativeChange ? safePercentChange(expNow.value, expThen.value) : null;
  const explanation = growthExplanation(nprPct, expPct, nprAbs, expAbs, nprThen.value, expThen.value, comparability);
  const displayPrevious =
    nprThen.value !== null && expThen.value !== null
      ? `NPR ${moneyPhrase(nprThen.value)} · expenses ${moneyPhrase(expThen.value)}`
      : nprThen.value !== null
        ? `NPR ${moneyPhrase(nprThen.value)}`
        : expThen.value !== null
          ? `Expenses ${moneyPhrase(expThen.value)}`
          : "Not available";
  const displayCurrent =
    nprNow.value !== null && expNow.value !== null
      ? `NPR ${moneyPhrase(nprNow.value)} · expenses ${moneyPhrase(expNow.value)}`
      : nprNow.value !== null
        ? `NPR ${moneyPhrase(nprNow.value)}`
        : expNow.value !== null
          ? `Expenses ${moneyPhrase(expNow.value)}`
          : "Not available";
  const rateDiff = nprPct !== null && expPct !== null ? expPct - nprPct : null;
  return {
    id: "card:revenue_expense_growth",
    slot: "revenue_expense_growth",
    title: "Revenue and patient-service expense growth",
    measureIds: ["net_patient_revenue", "patient_service_expenses"],
    previousDisplay: displayPrevious,
    currentDisplay: displayCurrent,
    previousExact:
      nprThen.value !== null && expThen.value !== null
        ? `NPR ${moneyExact(nprThen.value)}; expenses ${moneyExact(expThen.value)}`
        : nprThen.value !== null
          ? moneyExact(nprThen.value)
          : expThen.value !== null
            ? moneyExact(expThen.value)
            : "Not available",
    currentExact:
      nprNow.value !== null && expNow.value !== null
        ? `NPR ${moneyExact(nprNow.value)}; expenses ${moneyExact(expNow.value)}`
        : nprNow.value !== null
          ? moneyExact(nprNow.value)
          : expNow.value !== null
            ? moneyExact(expNow.value)
            : "Not available",
    previousRaw: nprThen.value,
    currentRaw: nprNow.value,
    absoluteLabel:
      nprAbs !== null && expAbs !== null
        ? `NPR ${signedMoney(nprAbs)} · expenses ${signedMoney(expAbs)}`
        : nprAbs !== null
          ? signedMoney(nprAbs)
          : expAbs !== null
            ? signedMoney(expAbs)
            : null,
    relativeLabel:
      nprPct !== null && expPct !== null
        ? `NPR ${signedNumber(nprPct)}% · expenses ${signedNumber(expPct)}%`
        : nprPct !== null
          ? `${signedNumber(nprPct)}%`
          : expPct !== null
            ? `${signedNumber(expPct)}%`
            : null,
    relativeKind: nprPct !== null || expPct !== null ? "percent" : "absolute_only",
    relativeValue: rateDiff,
    absoluteValue: nprAbs,
    explanation,
    direction: directionOf(nprAbs ?? expAbs),
    comparable: comparability.permitsRelativeChange && nprNow.value !== null && nprThen.value !== null,
    limitation: comparability.permitsRelativeChange
      ? percentChangeNote(nprThen.value) ?? percentChangeNote(expThen.value)
      : comparabilityCaption(comparability),
    ...chartMeta("npr_expenses"),
    originNote: "CMS Net Patient Revenue and Less Total Operating Expense. Not total hospital revenue.",
    details: [
      `Previous report: ${periodLabel(previous)}`,
      `Net patient revenue: ${nprThen.value === null ? "Not available" : moneyExact(nprThen.value)}`,
      `Patient-service expenses: ${expThen.value === null ? "Not available" : moneyExact(expThen.value)}`,
      `Selected report: ${periodLabel(current)}`,
      `Net patient revenue: ${nprNow.value === null ? "Not available" : moneyExact(nprNow.value)}`,
      `Patient-service expenses: ${expNow.value === null ? "Not available" : moneyExact(expNow.value)}`,
      nprPct !== null ? `Net patient revenue growth rate: ${signedNumber(nprPct)}%` : percentChangeNote(nprThen.value) ?? "Net patient revenue growth rate was not calculated.",
      expPct !== null ? `Patient-service expense growth rate: ${signedNumber(expPct)}%` : percentChangeNote(expThen.value) ?? "Patient-service expense growth rate was not calculated.",
      rateDiff !== null
        ? `Growth-rate difference (expenses minus revenue): ${signedNumber(rateDiff)} percentage points. That is not the dollar change in the patient-service result.`
        : "A growth-rate difference is shown only when both measures have a valid positive baseline.",
      comparability.note,
      ...comparability.checks.map((check) => check.detail),
      MEASURES.net_patient_revenue.not,
      MEASURES.patient_service_expenses.not,
    ],
    sources: uniqueSources([previous, current]),
  };
}

function growthExplanation(
  nprPct: number | null,
  expPct: number | null,
  nprAbs: number | null,
  expAbs: number | null,
  nprPrevious: number | null,
  expPrevious: number | null,
  comparability: ComparabilityResult,
): string {
  const parts: string[] = [];
  if (comparability.state === "incompatible") {
    parts.push("Both reporting periods are shown. PulseLine does not treat these reports as a continuous trend.");
    parts.push(comparabilityCaption(comparability));
  } else if (nprPct !== null && expPct !== null) {
    if (nprPct > 0 && expPct > 0) {
      parts.push(
        expPct > nprPct
          ? "Expenses increased faster than net patient revenue across these reports."
          : nprPct > expPct
            ? "Net patient revenue increased faster than patient-service expenses across these reports."
            : "Net patient revenue and patient-service expenses increased at the same rate across these reports.",
      );
    } else if (nprPct < 0 && expPct < 0) {
      parts.push(
        expPct < nprPct
          ? "Patient-service expenses decreased faster than net patient revenue across these reports."
          : nprPct < expPct
            ? "Net patient revenue decreased faster than patient-service expenses across these reports."
            : "Net patient revenue and patient-service expenses decreased at the same rate across these reports.",
      );
    } else if (nprPct > 0 && expPct < 0) {
      parts.push("Net patient revenue increased while patient-service expenses decreased across these reports.");
    } else if (nprPct < 0 && expPct > 0) {
      parts.push("Patient-service expenses increased while net patient revenue decreased across these reports.");
    } else if (nprPct === 0 && expPct !== 0) {
      parts.push(
        expPct > 0
          ? "Patient-service expenses increased while net patient revenue was unchanged across these reports."
          : "Patient-service expenses decreased while net patient revenue was unchanged across these reports.",
      );
    } else if (expPct === 0 && nprPct !== 0) {
      parts.push(
        nprPct > 0
          ? "Net patient revenue increased while patient-service expenses were unchanged across these reports."
          : "Net patient revenue decreased while patient-service expenses were unchanged across these reports.",
      );
    } else {
      parts.push("Net patient revenue and patient-service expenses were unchanged across these reports.");
    }
    parts.push(
      `The growth-rate difference is ${signedNumber(expPct - nprPct)} percentage points. That is not the same as the dollar change between the two measures.`,
    );
  } else {
    if (nprPct === null) parts.push(percentChangeNote(nprPrevious) ?? "Net patient revenue growth is not shown as a percentage.");
    if (expPct === null) parts.push(percentChangeNote(expPrevious) ?? "Patient-service expense growth is not shown as a percentage.");
    if (nprAbs !== null) parts.push(`Net patient revenue changed by ${signedMoney(nprAbs)} between these reports.`);
    if (expAbs !== null) parts.push(`Patient-service expenses changed by ${signedMoney(expAbs)} between these reports.`);
    if (nprAbs !== null && expAbs !== null) {
      parts.push("Those dollar changes are not a growth-rate comparison.");
    }
  }
  parts.push("Net patient revenue is not total hospital revenue. Patient-service expenses are CMS Less Total Operating Expense, not a validated overall operating-cost total.");
  if (comparability.state === "comparable") parts.push("This is a two-report comparison, not a multi-year trend.");
  else if (comparability.state === "limited") parts.push(comparabilityCaption(comparability));
  return parts.join(" ");
}

function resultCard(current: HospitalView, previous: HospitalView): { card: ChangeCard; usedDerived: boolean } | null {
  const publishedNow = measureValue(current, "published_patient_service_result");
  const publishedThen = measureValue(previous, "published_patient_service_result");
  const derivedNow = measureValue(current, "derived_patient_service_balance");
  const derivedThen = measureValue(previous, "derived_patient_service_balance");
  const publishedAvailable = publishedNow.value !== null || publishedThen.value !== null;
  const derivedAvailable = derivedNow.value !== null || derivedThen.value !== null;
  if (!publishedAvailable && !derivedAvailable) return null;
  if (publishedAvailable) {
    const reconcile = patientServiceReconcile(current.hospital);
    return {
      usedDerived: false,
      card: measureCard(
        current,
        previous,
        "published_patient_service_result",
        "patient_service_result",
        "Published patient-service result",
        "patient_service_result",
        [
          reconcile.note,
          "PulseLine does not substitute this figure with overall operating margin.",
        ],
      ),
    };
  }
  const derived = measureCard(
    current,
    previous,
    "derived_patient_service_balance",
    "patient_service_result",
    "Derived patient-service balance",
    "patient_service_result",
    ["This is NPR minus patient-service expenses. It is not the published CMS result and not overall operating profit."],
  );
  return {
    usedDerived: true,
    card: {
      ...derived,
      explanation: `${derived.explanation} This is an explicitly derived balance, not a published operating margin.`,
    },
  };
}

function liquidityCard(current: HospitalView, previous: HospitalView): ChangeCard | null {
  const cashNow = measureValue(current, "cash");
  const cashThen = measureValue(previous, "cash");
  if (cashNow.value !== null || cashThen.value !== null) {
    return measureCard(current, previous, "cash", "liquidity", "Cash", "cash_liquidity");
  }
  const ratioNow = measureValue(current, "current_ratio");
  const ratioThen = measureValue(previous, "current_ratio");
  if (ratioNow.value !== null || ratioThen.value !== null || ratioNow.excluded || ratioThen.excluded) {
    return measureCard(current, previous, "current_ratio", "liquidity", "Current ratio", "current_ratio");
  }
  return null;
}

function assetsCard(current: HospitalView, previous: HospitalView): ChangeCard | null {
  const assetsNow = measureValue(current, "total_assets");
  const assetsThen = measureValue(previous, "total_assets");
  const liabNow = measureValue(current, "total_liabilities");
  const liabThen = measureValue(previous, "total_liabilities");
  if (assetsNow.value !== null || assetsThen.value !== null || liabNow.value !== null || liabThen.value !== null) {
    const comparability = compareTwoReports(current, previous, "total_assets");
    const assetAbs = assetsNow.value !== null && assetsThen.value !== null ? assetsNow.value - assetsThen.value : null;
    const liabAbs = liabNow.value !== null && liabThen.value !== null ? liabNow.value - liabThen.value : null;
    const assetPct = comparability.permitsRelativeChange ? safePercentChange(assetsNow.value, assetsThen.value) : null;
    const liabPct = comparability.permitsRelativeChange ? safePercentChange(liabNow.value, liabThen.value) : null;
    const parts: string[] = [];
    if (assetAbs !== null) parts.push(`Total assets ${directionWord(directionOf(assetAbs))} from ${formatMeasure("total_assets", assetsThen.value)} to ${formatMeasure("total_assets", assetsNow.value)}.`);
    if (liabAbs !== null) parts.push(`Total liabilities ${directionWord(directionOf(liabAbs))} from ${formatMeasure("total_liabilities", liabThen.value)} to ${formatMeasure("total_liabilities", liabNow.value)}.`);
    if (comparability.state === "comparable") parts.push("This is a two-report comparison, not a multi-year trend.");
    else parts.push(comparabilityCaption(comparability));
    parts.push("These are published CMS totals, not enterprise value.");
    return {
      id: "card:assets_liabilities",
      slot: "assets_liabilities",
      title: "Assets and liabilities",
      measureIds: ["total_assets", "total_liabilities"],
      previousDisplay:
        assetsThen.value !== null && liabThen.value !== null
          ? `Assets ${moneyPhrase(assetsThen.value)} · liabilities ${moneyPhrase(liabThen.value)}`
          : assetsThen.value !== null
            ? `Assets ${moneyPhrase(assetsThen.value)}`
            : liabThen.value !== null
              ? `Liabilities ${moneyPhrase(liabThen.value)}`
              : "Not available",
      currentDisplay:
        assetsNow.value !== null && liabNow.value !== null
          ? `Assets ${moneyPhrase(assetsNow.value)} · liabilities ${moneyPhrase(liabNow.value)}`
          : assetsNow.value !== null
            ? `Assets ${moneyPhrase(assetsNow.value)}`
            : liabNow.value !== null
              ? `Liabilities ${moneyPhrase(liabNow.value)}`
              : "Not available",
      previousExact:
        assetsThen.value !== null && liabThen.value !== null
          ? `Assets ${moneyExact(assetsThen.value)}; liabilities ${moneyExact(liabThen.value)}`
          : assetsThen.value !== null
            ? moneyExact(assetsThen.value)
            : liabThen.value !== null
              ? moneyExact(liabThen.value)
              : "Not available",
      currentExact:
        assetsNow.value !== null && liabNow.value !== null
          ? `Assets ${moneyExact(assetsNow.value)}; liabilities ${moneyExact(liabNow.value)}`
          : assetsNow.value !== null
            ? moneyExact(assetsNow.value)
            : liabNow.value !== null
              ? moneyExact(liabNow.value)
              : "Not available",
      previousRaw: assetsThen.value,
      currentRaw: assetsNow.value,
      absoluteLabel:
        assetAbs !== null && liabAbs !== null
          ? `Assets ${signedMoney(assetAbs)} · liabilities ${signedMoney(liabAbs)}`
          : assetAbs !== null
            ? signedMoney(assetAbs)
            : liabAbs !== null
              ? signedMoney(liabAbs)
              : null,
      relativeLabel:
        assetPct !== null && liabPct !== null
          ? `Assets ${signedNumber(assetPct)}% · liabilities ${signedNumber(liabPct)}%`
          : assetPct !== null
            ? `${signedNumber(assetPct)}%`
            : liabPct !== null
              ? `${signedNumber(liabPct)}%`
              : null,
      relativeKind: assetPct !== null || liabPct !== null ? "percent" : "absolute_only",
      relativeValue: assetPct,
      absoluteValue: assetAbs,
      explanation: parts.join(" "),
      direction: directionOf(assetAbs),
      comparable: comparability.permitsRelativeChange && assetsNow.value !== null && assetsThen.value !== null,
      limitation: comparability.state === "comparable" ? null : comparabilityCaption(comparability),
      ...chartMeta("assets_liabilities"),
      originNote: "CMS Total Assets and Total Liabilities. Negative published values are preserved.",
      details: [
        `Previous report: ${periodLabel(previous)}`,
        `Total assets: ${assetsThen.value === null ? "Not available" : moneyExact(assetsThen.value)}`,
        `Total liabilities: ${liabThen.value === null ? "Not available" : moneyExact(liabThen.value)}`,
        `Selected report: ${periodLabel(current)}`,
        `Total assets: ${assetsNow.value === null ? "Not available" : moneyExact(assetsNow.value)}`,
        `Total liabilities: ${liabNow.value === null ? "Not available" : moneyExact(liabNow.value)}`,
        comparability.note,
        ...comparability.checks.map((check) => check.detail),
        MEASURES.total_assets.not,
        MEASURES.total_liabilities.not,
      ],
      sources: uniqueSources([previous, current]),
    };
  }
  const leverageNow = measureValue(current, "liabilities_to_assets");
  const leverageThen = measureValue(previous, "liabilities_to_assets");
  if (leverageNow.value !== null || leverageThen.value !== null || leverageNow.excluded || leverageThen.excluded) {
    return measureCard(current, previous, "liabilities_to_assets", "assets_liabilities", "Liabilities / assets", "assets_liabilities");
  }
  return null;
}

function operationalCard(current: HospitalView, previous: HospitalView): ChangeCard | null {
  const now = measureValue(current, "inpatient_utilization");
  const then = measureValue(previous, "inpatient_utilization");
  if (now.value === null && then.value === null && !now.excluded && !then.excluded) return null;
  const card = measureCard(
    current,
    previous,
    "inpatient_utilization",
    "operational",
    "Operational: inpatient utilization",
    "npr_expenses",
    ["This measure is operational. It is not a financial result."],
  );
  return {
    ...card,
    explanation: `Operational utilization, not a financial result. ${card.explanation}`,
  };
}

function pendingRecordsNeeded(): string[] {
  return [
    "Historical CMS cost-report financials for a verified facility identity (do not join on an unverified CCN).",
    "Fiscal period start and end dates, distinct from CMS file-cohort years.",
    "Net patient revenue, patient-service expenses, and published patient-service result as originally reported.",
    "Balance-sheet totals and cash as published, including negative values.",
    "Reporting-entity versus parent consolidation scope.",
    "Verified source publication dates when making point-in-time historical claims.",
  ];
}

function emptyBrief(input: WhatChangedInput, status: WhatChangedBrief["status"], extra: Partial<WhatChangedBrief> = {}): WhatChangedBrief {
  const name = input.hospitalName ?? input.view?.hospital.name ?? "This hospital";
  return {
    status,
    hospitalName: name,
    currentPeriod: input.view ? briefPeriod(input.view) : null,
    previousPeriod: null,
    comparable: false,
    comparability: null,
    defaultCards: [],
    remainingCards: [],
    allCards: [],
    records: [],
    changes: [],
    investigate: [],
    limitations: [],
    sources: [],
    pendingReason: null,
    recordsNeeded: [],
    editorialRule: EDITORIAL_CARD_RULE,
    exploratoryRule: EXPLORATORY_CHANGE_RULE,
    ...extra,
  };
}

function cardToLine(card: ChangeCard): BriefLine {
  return {
    id: card.id,
    text: card.explanation,
    periodLabel: null,
  };
}

export function whatChangedBrief(input: WhatChangedInput): WhatChangedBrief {
  const asOf = input.asOf ?? new Date();
  const name = input.hospitalName ?? input.view?.hospital.name ?? "This hospital";
  if (input.pending || !input.view) {
    return emptyBrief(input, "pending", {
      hospitalName: name,
      pendingReason: `Financial data pending for ${name}. PulseLine did not invent a CCN, financials, score, or comparison.`,
      recordsNeeded: pendingRecordsNeeded(),
      changes: [
        {
          id: "pending",
          text: `Financial data pending for ${name}. No change cards, financial scores, or comparisons were generated.`,
          periodLabel: null,
        },
      ],
      investigate: [
        {
          id: "records_needed",
          text: pendingRecordsNeeded().join(" "),
          periodLabel: null,
        },
      ],
      limitations: [
        `Financial data pending for ${name}. PulseLine did not invent a CCN, financials, score, or comparison.`,
        "Sourced events can be reviewed while financial coverage remains pending.",
      ],
    });
  }

  const current = input.view;
  const period = periodMeta(current, asOf);
  const previous = priorReport(input.reports, current);
  const records: BriefLine[] = [
    {
      id: "period",
      text: `Selected fiscal period ${period.start ? `${period.start} to ${period.end}` : `ending ${period.end}`}. ${period.historicalNote}`,
      periodLabel: periodLabel(current),
    },
  ];
  const npr = measureValue(current, "net_patient_revenue");
  records.push({
    id: npr.value === null ? "npr_missing" : "npr",
    text:
      npr.value === null
        ? "Net patient revenue is missing in this report. Missing is not zero."
        : `Net patient revenue was ${moneyPhrase(npr.value)}. That is CMS Net Patient Revenue, not total hospital revenue.`,
    periodLabel: periodLabel(current),
  });
  const expenses = measureValue(current, "patient_service_expenses");
  if (expenses.value !== null) {
    records.push({
      id: "expenses",
      text: `Patient-service expenses were ${moneyPhrase(expenses.value)} (CMS Less Total Operating Expense).`,
      periodLabel: periodLabel(current),
    });
  }
  const reconcile = patientServiceReconcile(current.hospital);
  if (reconcile.published !== null && reconcile.derived !== null) {
    records.push({
      id: "result",
      text: reconcile.reconciled
        ? `The published patient-service result was ${moneyPhrase(reconcile.published)}, matching the derived balance.`
        : `Published patient-service result ${moneyPhrase(reconcile.published)} differs from the derived balance ${moneyPhrase(reconcile.derived)}. Both are shown.`,
      periodLabel: periodLabel(current),
    });
  }

  if (!previous) {
    return emptyBrief(input, "no_prior", {
      hospitalName: name,
      currentPeriod: briefPeriod(current),
      records,
      changes: [
        {
          id: "no_prior",
          text: "No earlier fiscal report is available for a comparison. PulseLine does not skip to a different hospital or invent a prior period.",
          periodLabel: periodLabel(current),
        },
      ],
      investigate: investigateLines(current, period, reconcile),
      limitations: [
        "No earlier fiscal report is available for a comparison.",
        period.publicationLabel,
        "Reporting-entity versus parent consolidation is not independently reconciled.",
      ],
      sources: uniqueSources([current]),
    });
  }

  const comparability = compareTwoReports(current, previous);
  const slotCards: ChangeCard[] = [];
  const growth = growthCard(current, previous);
  if (growth) slotCards.push(growth);
  const result = resultCard(current, previous);
  if (result) slotCards.push(result.card);
  const liquidity = liquidityCard(current, previous);
  if (liquidity) slotCards.push(liquidity);
  const assets = assetsCard(current, previous);
  if (assets) slotCards.push(assets);
  const operational = operationalCard(current, previous);
  if (operational) slotCards.push(operational);

  const additional: ChangeCard[] = [];
  const usedIds = new Set(slotCards.flatMap((card) => card.measureIds));
  if (growth) {
    usedIds.add("net_patient_revenue");
    usedIds.add("patient_service_expenses");
  }
  if (result && !result.usedDerived) {
    const currentReconcile = patientServiceReconcile(current.hospital);
    if (!currentReconcile.reconciled && currentReconcile.derived !== null) {
      additional.push(
        measureCard(
          current,
          previous,
          "derived_patient_service_balance",
          "additional",
          "Derived patient-service balance",
          "patient_service_result",
          [currentReconcile.note],
        ),
      );
    }
    usedIds.add("published_patient_service_result");
  }
  if (liquidity?.measureIds.includes("cash")) {
    const ratioNow = measureValue(current, "current_ratio");
    const ratioThen = measureValue(previous, "current_ratio");
    if (ratioNow.value !== null || ratioThen.value !== null || ratioNow.excluded || ratioThen.excluded) {
      additional.push(measureCard(current, previous, "current_ratio", "additional", "Current ratio", "current_ratio"));
    }
  }
  if (assets && !assets.measureIds.includes("liabilities_to_assets")) {
    const leverageNow = measureValue(current, "liabilities_to_assets");
    const leverageThen = measureValue(previous, "liabilities_to_assets");
    if (leverageNow.value !== null || leverageThen.value !== null || leverageNow.excluded || leverageThen.excluded) {
      additional.push(
        measureCard(current, previous, "liabilities_to_assets", "additional", "Liabilities / assets", "assets_liabilities"),
      );
    }
  }
  const ratioNow = measureValue(current, "patient_service_result_ratio");
  const ratioThen = measureValue(previous, "patient_service_result_ratio");
  if (ratioNow.value !== null || ratioThen.value !== null || ratioNow.excluded || ratioThen.excluded) {
    additional.push(
      measureCard(
        current,
        previous,
        "patient_service_result_ratio",
        "additional",
        "Patient-service result ratio",
        "patient_service_result",
        ["This ratio is not a validated overall operating margin."],
      ),
    );
  }

  const defaultCards = slotCards.slice(0, 3);
  const remainingCards = [...slotCards.slice(3), ...additional];
  const seenRemaining = new Set(defaultCards.map((card) => card.id));
  const uniqueRemaining = remainingCards.filter((card) => {
    if (seenRemaining.has(card.id)) return false;
    seenRemaining.add(card.id);
    return true;
  });
  const allCards = [...defaultCards, ...uniqueRemaining];
  const limitations = collectLimitations(current, previous, comparability, period, allCards);

  return {
    status: "ready",
    hospitalName: name,
    currentPeriod: briefPeriod(current),
    previousPeriod: briefPeriod(previous),
    comparable: comparability.comparable,
    comparability,
    defaultCards,
    remainingCards: uniqueRemaining,
    allCards,
    records,
    changes: allCards.length > 0 ? allCards.map(cardToLine) : [
      {
        id: "no_supported",
        text: "No supported comparison is available for these two reports.",
        periodLabel: periodLabel(current),
      },
    ],
    investigate: investigateLines(current, period, reconcile, comparability.checks),
    limitations,
    sources: uniqueSources([previous, current]),
    pendingReason: null,
    recordsNeeded: [],
    editorialRule: EDITORIAL_CARD_RULE,
    exploratoryRule: EXPLORATORY_CHANGE_RULE,
  };
}

function investigateLines(
  view: HospitalView,
  period: ReturnType<typeof periodMeta>,
  reconcile: ReturnType<typeof patientServiceReconcile>,
  checks: ComparabilityCheck[] = [],
): BriefLine[] {
  const lines: BriefLine[] = [
    { id: "publication", text: period.publicationLabel, periodLabel: periodLabel(view) },
    {
      id: "scope",
      text: "Reporting-entity versus parent consolidation is not independently reconciled.",
      periodLabel: periodLabel(view),
    },
  ];
  if (view.hospital.dataQuality.addressMismatch) {
    lines.push({
      id: "address",
      text: "A street-address discrepancy is recorded and is not a workforce finding.",
      periodLabel: periodLabel(view),
    });
  }
  if (view.hospital.historicalCcn && view.hospital.currentCcn && view.hospital.historicalCcn !== view.hospital.currentCcn) {
    lines.push({
      id: "ccn",
      text: `Reported CCN ${view.hospital.historicalCcn} differs from current CCN ${view.hospital.currentCcn}.`,
      periodLabel: periodLabel(view),
    });
  }
  if (!reconcile.reconciled && reconcile.published !== null && reconcile.derived !== null) {
    lines.push({ id: "reconcile", text: reconcile.note, periodLabel: periodLabel(view) });
  }
  for (const check of checks.filter((item) => item.status !== "pass")) {
    lines.push({ id: `check:${check.id}`, text: check.detail, periodLabel: periodLabel(view) });
  }
  return lines;
}

function collectLimitations(
  current: HospitalView,
  previous: HospitalView,
  comparability: ComparabilityResult,
  period: ReturnType<typeof periodMeta>,
  cards: ChangeCard[],
): string[] {
  const lines = [
    comparabilityCaption(comparability),
    period.publicationLabel,
    period.ageLabel,
    "Fiscal-end age is not a source publication date or an access date.",
    period.publicationStatus === "unverified"
      ? "Unknown publication dates limit point-in-time historical claims. They do not prevent clearly labeled retrospective viewing of these reports."
      : null,
    "Reporting-entity versus parent consolidation is not independently reconciled. Unknown consolidation scope remains visible and does not establish full comparability.",
    EDITORIAL_CARD_RULE,
    ...cards.map((card) => card.limitation),
  ].filter((item): item is string => Boolean(item));
  return [...new Set(lines)];
}

export function formatWhatChangedAnswer(brief: WhatChangedBrief): {
  statement: string;
  limitations: string[];
  lockedFacts: string[];
} {
  if (brief.status === "pending") {
    return {
      statement: brief.pendingReason ?? `Financial data pending for ${brief.hospitalName}.`,
      limitations: brief.limitations,
      lockedFacts: ["financials=pending"],
    };
  }
  if (brief.status === "no_prior" || !brief.previousPeriod || !brief.currentPeriod) {
    const selected = brief.currentPeriod?.label ?? "the selected report";
    return {
      statement: `${brief.hospitalName} has no earlier fiscal report to compare with ${selected}. PulseLine does not skip to a different report to produce a change.`,
      limitations: brief.limitations,
      lockedFacts: brief.currentPeriod ? [`selected_end=${brief.currentPeriod.end}`] : [],
    };
  }

  const header = `${brief.hospitalName} — comparison of the ${brief.previousPeriod.label} report with the selected ${brief.currentPeriod.label} report. Both reporting periods are shown.`;
  const cardLines = (brief.defaultCards.length > 0 ? brief.defaultCards : brief.allCards).map((card) => {
    const relative = card.relativeLabel ? ` ${card.relativeLabel}.` : "";
    const absolute = card.absoluteLabel ? ` Absolute change ${card.absoluteLabel}.` : "";
    return `${card.title}: ${card.previousExact} → ${card.currentExact}.${absolute}${relative} ${card.explanation}`;
  });
  const remaining =
    brief.remainingCards.length > 0
      ? `Additional supported measures are available in PulseLine (${brief.remainingCards.map((card) => card.title).join("; ")}).`
      : null;
  const comparability =
    brief.comparability?.state === "comparable" || brief.comparable
      ? "This is a two-report comparison, not a multi-year trend."
      : brief.comparability
        ? comparabilityCaption(brief.comparability)
        : "Comparability limitation: These reports are not treated as a continuous trend.";
  const statement = [header, ...cardLines, remaining, comparability].filter(Boolean).join(" ");
  const lockedFacts = [
    `previous_start=${brief.previousPeriod.start ?? ""}`,
    `previous_end=${brief.previousPeriod.end}`,
    `selected_start=${brief.currentPeriod.start ?? ""}`,
    `selected_end=${brief.currentPeriod.end}`,
    `comparable=${brief.comparable}`,
    `comparability_state=${brief.comparability?.state ?? "unknown"}`,
    ...brief.allCards.flatMap((card) => [
      `${card.id}:previous=${card.previousRaw ?? "null"}`,
      `${card.id}:current=${card.currentRaw ?? "null"}`,
      `${card.id}:absolute=${card.absoluteValue ?? "null"}`,
      `${card.id}:relative=${card.relativeValue ?? "null"}`,
      `${card.id}:kind=${card.relativeKind}`,
    ]),
  ];
  return { statement, limitations: brief.limitations, lockedFacts };
}

export function guidedBrief(view: HospitalView, reports: HospitalView[], asOf = new Date()): GuidedBrief {
  const brief = whatChangedBrief({ view, reports, asOf, hospitalName: view.hospital.name });
  return {
    records: brief.records,
    changes: brief.changes,
    investigate: brief.investigate,
    exploratoryRule: brief.exploratoryRule,
  };
}
