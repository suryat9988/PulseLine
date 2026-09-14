import type { HospitalView } from "../../src/types.ts";
import { MEASURES, type MeasureId } from "./measures.ts";

export const PERIOD_DAY_TOLERANCE = 30;

export const EXPLORATORY_CHANGE_PCT = 10;
export const EXPLORATORY_CHANGE_RULE =
  "A 10 percentage-point display cue is an exploratory PulseLine rule. It is not a materiality, audit, credit, or valuation threshold.";

export const COMPARABILITY_STATES = ["comparable", "limited", "incompatible"] as const;
export type ComparabilityState = (typeof COMPARABILITY_STATES)[number];

export const CHECK_STATUSES = ["pass", "unknown", "fail"] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export interface ComparabilityCheck {
  id: string;
  status: CheckStatus;
  ok: boolean;
  detail: string;
}

export interface ComparabilityResult {
  state: ComparabilityState;
  comparable: boolean;
  permitsRelativeChange: boolean;
  checks: ComparabilityCheck[];
  note: string;
}

function check(id: string, status: CheckStatus, detail: string): ComparabilityCheck {
  return { id, status, ok: status === "pass", detail };
}

function parseIso(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) ? time : null;
}

export function periodsOverlap(left: HospitalView, right: HospitalView): boolean {
  const leftStart = parseIso(left.hospital.fiscalYearStart) ?? parseIso(left.hospital.fiscalYearEnd);
  const rightStart = parseIso(right.hospital.fiscalYearStart) ?? parseIso(right.hospital.fiscalYearEnd);
  const leftEnd = parseIso(left.hospital.fiscalYearEnd);
  const rightEnd = parseIso(right.hospital.fiscalYearEnd);
  if (leftStart === null || rightStart === null || leftEnd === null || rightEnd === null) return false;
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

export function orderedReports(reports: HospitalView[]): HospitalView[] {
  return [...reports].sort((left, right) => left.hospital.fiscalYearEnd.localeCompare(right.hospital.fiscalYearEnd));
}

export function classifyReportingScope(scope: string | null | undefined): "facility" | "parent" | "unknown" | "recorded" {
  if (scope == null || scope.trim() === "") return "unknown";
  const lower = scope.toLowerCase();
  if (/^unknown\b/.test(lower) || lower === "n/a" || lower === "null") return "unknown";
  const mentionsParent = /\bparent\b/.test(lower);
  const mentionsFacility = /\bfacility\b/.test(lower) || /\bhospital\b/.test(lower) || /\bprovider\b/.test(lower);
  if (mentionsParent && !mentionsFacility) return "parent";
  if (mentionsFacility && !mentionsParent) return "facility";
  return "recorded";
}

function durationCheck(currentDays: number | null, previousDays: number | null): ComparabilityCheck {
  if (currentDays == null || previousDays == null) {
    return check(
      "duration",
      "unknown",
      "Reporting-period length is missing on at least one report, so PulseLine cannot verify that these periods are within 30 days of each other.",
    );
  }
  if (Math.abs(currentDays - previousDays) > PERIOD_DAY_TOLERANCE) {
    return check(
      "duration",
      "fail",
      "Reporting-period lengths differ by more than 30 days, so PulseLine does not treat these as a continuous trend.",
    );
  }
  return check("duration", "pass", "Reporting-period lengths are within 30 days of each other.");
}

function entityScopeCheck(currentScope: string | null | undefined, previousScope: string | null | undefined): ComparabilityCheck {
  const currentKind = classifyReportingScope(currentScope);
  const previousKind = classifyReportingScope(previousScope);
  if (currentKind === "unknown" || previousKind === "unknown") {
    return check(
      "entity_scope",
      "unknown",
      "Reporting-entity versus parent consolidation is not independently reconciled. Figures can be viewed retrospectively. This is not verified same-entity growth.",
    );
  }
  if (
    (currentKind === "facility" && previousKind === "parent") ||
    (currentKind === "parent" && previousKind === "facility")
  ) {
    return check(
      "entity_scope",
      "fail",
      `Recorded scopes differ (“${previousScope}” vs “${currentScope}”). PulseLine does not treat facility and parent reports as same-entity growth.`,
    );
  }
  const currentRaw = currentScope?.trim() ?? "";
  const previousRaw = previousScope?.trim() ?? "";
  if (currentRaw !== previousRaw) {
    return check(
      "entity_scope",
      "fail",
      `Recorded scopes differ (“${previousScope}” vs “${currentScope}”). PulseLine does not treat these as same-entity growth.`,
    );
  }
  return check("entity_scope", "pass", `Both reports use the recorded scope “${currentScope}”.`);
}

function finalize(checks: ComparabilityCheck[]): ComparabilityResult {
  const failed = checks.filter((item) => item.status === "fail");
  const unknown = checks.filter((item) => item.status === "unknown");
  const state: ComparabilityState = failed.length > 0 ? "incompatible" : unknown.length > 0 ? "limited" : "comparable";
  const duration = checks.find((item) => item.id === "duration");
  const permitsRelativeChange = state !== "incompatible" && duration?.status === "pass";
  const note =
    state === "comparable"
      ? "Lines connect successive fiscal reports that use the same CMS measure. A few reports are not a statistically established trend."
      : state === "limited"
        ? unknown.map((item) => item.detail).join(" ")
        : failed.map((item) => item.detail).join(" ");
  return {
    state,
    comparable: state === "comparable",
    permitsRelativeChange,
    checks,
    note,
  };
}

export function compareTwoReports(current: HospitalView, previous: HospitalView, measureId?: MeasureId): ComparabilityResult {
  const measure = measureId ? MEASURES[measureId] : null;
  const checks: ComparabilityCheck[] = [
    check(
      "definition",
      "pass",
      measure
        ? `${measure.label} uses the same PulseLine definition on both reports.`
        : "Compared reports use the same PulseLine measure definitions.",
    ),
    check("unit", "pass", measure ? `Unit is ${measure.unit} on both reports.` : "Compared figures keep their original units."),
    durationCheck(current.hospital.periodDays, previous.hospital.periodDays),
    entityScopeCheck(current.hospital.reportingScope, previous.hospital.reportingScope),
  ];

  const sameRecord =
    current.hospital.reportRecordId !== null && current.hospital.reportRecordId === previous.hospital.reportRecordId;
  const overlap = current.hospital.id !== previous.hospital.id && periodsOverlap(current, previous);
  checks.push(
    check(
      "overlap",
      sameRecord || overlap ? "fail" : "pass",
      sameRecord
        ? "These rows share a CMS report record id."
        : overlap
          ? "The fiscal periods overlap, so PulseLine does not present an unqualified growth rate."
          : "The fiscal periods do not overlap and are not the same CMS report record.",
    ),
  );

  return finalize(checks);
}

export function periodSetComparability(reports: HospitalView[]): ComparabilityResult {
  const ordered = orderedReports(reports);
  if (ordered.length < 2) {
    return {
      state: "comparable",
      comparable: true,
      permitsRelativeChange: false,
      checks: [],
      note: "A single report is shown. PulseLine does not claim a trend from one observation.",
    };
  }

  let limited: ComparabilityResult | null = null;
  for (let index = 1; index < ordered.length; index += 1) {
    const pair = compareTwoReports(ordered[index], ordered[index - 1]);
    if (pair.state === "incompatible") return pair;
    if (pair.state === "limited") limited = pair;
  }
  if (limited) return limited;

  const factorSets = ordered.map((report) => [...report.financial.reconstruction.availableFactorIds].sort().join(","));
  const factorShift = new Set(factorSets).size > 1;
  return {
    state: "comparable",
    comparable: true,
    permitsRelativeChange: true,
    checks: [],
    note: factorShift
      ? "Available scoring factors differ across reports, so score history is not strictly comparable. A few reports are not a statistically established trend."
      : "Lines connect successive fiscal reports that use the same CMS measure. A few reports are not a statistically established trend.",
  };
}

export function safePercentChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous <= 0) return null;
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  return ((current - previous) / previous) * 100;
}

export function percentChangeNote(previousValue: number | null): string | null {
  if (previousValue === null) return "PulseLine does not calculate percentage growth when the earlier value is missing. Missing is not zero.";
  if (previousValue === 0) return "PulseLine does not calculate percentage growth from a zero baseline.";
  if (previousValue < 0) return "PulseLine does not calculate percentage growth from a negative baseline.";
  return null;
}

export function comparabilityCaption(result: ComparabilityResult): string {
  if (result.state === "comparable") return result.note;
  if (result.state === "limited") return `Limited comparison: ${result.note}`;
  return `These reports are not comparable: ${result.note}`;
}

export function comparableChange(
  current: HospitalView,
  previous: HospitalView,
  currentValue: number | null,
  previousValue: number | null,
  measureId: MeasureId,
): { percent: number | null; comparable: boolean; state: ComparabilityState; note: string } {
  const comparability = compareTwoReports(current, previous, measureId);
  if (!comparability.permitsRelativeChange) {
    return {
      percent: null,
      comparable: false,
      state: comparability.state,
      note: comparability.note,
    };
  }
  const percent = safePercentChange(currentValue, previousValue);
  if (percent === null) {
    return {
      percent: null,
      comparable: comparability.comparable,
      state: comparability.state,
      note: percentChangeNote(previousValue) ?? "PulseLine does not calculate a change when a comparable earlier value is missing or not a valid positive baseline.",
    };
  }
  return {
    percent,
    comparable: comparability.comparable,
    state: comparability.state,
    note: comparability.note,
  };
}
