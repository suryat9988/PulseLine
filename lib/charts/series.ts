import type { HospitalView } from "../../src/types.ts";
import {
  comparabilityCaption,
  currentRatioValue,
  inpatientUtilizationValue,
  liabilitiesToAssetsValue,
  periodSetComparability,
  publishedPatientServiceResult,
  safePercentChange as financeSafePercentChange,
  type ComparabilityState,
} from "../finance/index.ts";

export type ChartUnit = "usd" | "ratio" | "days" | "score" | "percent";

export interface ChartPoint {
  reportId: string;
  start: string | null;
  end: string;
  periodDays: number | null;
  value: number | null;
  excluded: boolean;
  exclusion: string | null;
  fileCohort: number | null;
}

export interface ChartSeries {
  id: string;
  title: string;
  question: string;
  unit: ChartUnit;
  definition: string;
  points: ChartPoint[];
  comparable: boolean;
  comparabilityState: ComparabilityState;
  comparabilityNote: string;
}

function orderedReports(reports: HospitalView[]): HospitalView[] {
  return [...reports].sort((left, right) => left.hospital.fiscalYearEnd.localeCompare(right.hospital.fiscalYearEnd));
}

export function reportsComparable(reports: HospitalView[]): {
  comparable: boolean;
  state: ComparabilityState;
  note: string;
} {
  const result = periodSetComparability(reports);
  return { comparable: result.comparable, state: result.state, note: comparabilityCaption(result) };
}

function point(
  report: HospitalView,
  value: number | null,
  excluded = false,
  exclusion: string | null = null,
): ChartPoint {
  return {
    reportId: report.hospital.id,
    start: report.hospital.fiscalYearStart,
    end: report.hospital.fiscalYearEnd,
    periodDays: report.hospital.periodDays,
    value,
    excluded,
    exclusion,
    fileCohort: report.hospital.fileCohort,
  };
}

export function moneySeries(
  reports: HospitalView[],
  id: string,
  title: string,
  question: string,
  definition: string,
  read: (report: HospitalView) => number | null,
  invalid?: (value: number) => string | null,
): ChartSeries {
  const ordered = orderedReports(reports);
  const comparability = reportsComparable(ordered);
  return {
    id,
    title,
    question,
    unit: "usd",
    definition,
    comparable: comparability.comparable,
    comparabilityState: comparability.state,
    comparabilityNote: comparability.note,
    points: ordered.map((report) => {
      const value = read(report);
      if (value === null) return point(report, null, false, "Missing in this report. Missing is not zero.");
      const reason = invalid?.(value) ?? null;
      return point(report, value, Boolean(reason), reason);
    }),
  };
}

export function patientServiceResultSeries(reports: HospitalView[]): ChartSeries {
  const ordered = orderedReports(reports);
  const comparability = reportsComparable(ordered);
  return {
    id: "patient_service_result",
    title: "Patient-service result",
    question: "How did the reported patient-service result change across fiscal reports?",
    unit: "percent",
    definition:
      "Net Income from Service to Patients / Net Patient Revenue. Historical patient-care result, not overall operating margin.",
    comparable: comparability.comparable,
    comparabilityState: comparability.state,
    comparabilityNote: comparability.note,
    points: ordered.map((report) => {
      const income = publishedPatientServiceResult(report.hospital);
      const npr = report.hospital.financials.netPatientRevenue;
      if (income.error || income.value === null || npr === null) {
        return point(report, null, false, "Not calculated from this report.");
      }
      if (npr === 0) {
        return point(report, null, true, "Excluded: Net Patient Revenue is zero.");
      }
      return point(report, income.value / npr);
    }),
  };
}

export function liabilitiesAssetsSeries(reports: HospitalView[]): ChartSeries {
  const ordered = orderedReports(reports);
  const comparability = reportsComparable(ordered);
  return {
    id: "liabilities_assets",
    title: "Liabilities / assets",
    question: "Where is the liabilities-to-assets ratio interpretable?",
    unit: "ratio",
    definition: "Total Liabilities / Total Assets. Excluded when assets are ≤ 0 or liabilities are uninterpretable.",
    comparable: comparability.comparable,
    comparabilityState: comparability.state,
    comparabilityNote: comparability.note,
    points: ordered.map((report) => {
      const ratio = liabilitiesToAssetsValue(report.hospital);
      return point(report, ratio.value, ratio.excluded, ratio.exclusion);
    }),
  };
}

export function currentRatioSeries(reports: HospitalView[]): ChartSeries {
  const ordered = orderedReports(reports);
  const comparability = reportsComparable(ordered);
  return {
    id: "current_ratio",
    title: "Current ratio",
    question: "Where is the current ratio interpretable?",
    unit: "ratio",
    definition: "Total Current Assets / Total Current Liabilities. Excluded when current liabilities are ≤ 0.",
    comparable: comparability.comparable,
    comparabilityState: comparability.state,
    comparabilityNote: comparability.note,
    points: ordered.map((report) => {
      const ratio = currentRatioValue(report.hospital);
      return point(report, ratio.value, ratio.excluded, ratio.exclusion);
    }),
  };
}

export function utilizationSeries(reports: HospitalView[]): ChartSeries {
  const ordered = orderedReports(reports);
  const comparability = reportsComparable(ordered);
  return {
    id: "inpatient_utilization",
    title: "Inpatient utilization",
    question: "How did CMS inpatient utilization compare across fiscal reports?",
    unit: "percent",
    definition:
      "Total Days / Total Bed Days Available from the CMS fiscal report. Not Kentucky calendar-year utilization and not a financial measure.",
    comparable: comparability.comparable,
    comparabilityState: comparability.state,
    comparabilityNote: comparability.note,
    points: ordered.map((report) => {
      const utilization = inpatientUtilizationValue(report.hospital);
      return point(report, utilization.value, utilization.excluded, utilization.exclusion);
    }),
  };
}

export function scoreHistorySeries(reports: HospitalView[]): ChartSeries {
  const ordered = orderedReports(reports);
  const comparability = reportsComparable(ordered);
  return {
    id: "score_history",
    title: "Experimental score",
    question: "How did the experimental score and coverage change across reports?",
    unit: "score",
    definition: "PulseLine experimental score for each fiscal report. Coverage is shown separately and is not a score.",
    comparable: comparability.comparable,
    comparabilityState: comparability.state,
    comparabilityNote: comparability.note,
    points: ordered.map((report) => point(report, report.financial.score, report.financial.score === null, report.financial.score === null ? "No score. Coverage only." : null)),
  };
}

export function publishedResultSeries(reports: HospitalView[]): ChartSeries {
  return moneySeries(
    reports,
    "published_patient_service_result",
    "Patient-service result",
    "How did the published patient-service result compare across reports?",
    "CMS Net Income from Service to Patients. Not overall operating income, net income, or cash flow.",
    (report) => publishedPatientServiceResult(report.hospital).value,
  );
}

export function financialChartSeries(reports: HospitalView[]): ChartSeries[] {
  return [
    moneySeries(
      reports,
      "npr_expenses",
      "Revenue and patient-service expenses",
      "How did net patient revenue and patient-service expenses compare across reports?",
      "CMS Net Patient Revenue and Less Total Operating Expense. Not total hospital revenue or overall operating cost.",
      (report) => report.hospital.financials.netPatientRevenue,
    ),
    moneySeries(
      reports,
      "operating_expenses",
      "Patient-service expenses",
      "How did Less Total Operating Expense change across reports?",
      "CMS Less Total Operating Expense. Patient-service expense measure, not a validated overall operating total.",
      (report) => report.hospital.financials.operatingExpenses,
    ),
    patientServiceResultSeries(reports),
    moneySeries(
      reports,
      "assets",
      "Total assets",
      "How did reported assets change across reports?",
      "CMS Total Assets.",
      (report) => report.hospital.financials.totalAssets,
    ),
    moneySeries(
      reports,
      "liabilities",
      "Total liabilities",
      "How did reported liabilities change across reports?",
      "CMS Total Liabilities. Negative published values are preserved.",
      (report) => report.hospital.financials.totalLiabilities,
    ),
    moneySeries(
      reports,
      "cash",
      "Cash on hand",
      "How did cash change across reports?",
      "CMS Cash on Hand and in Banks. Negative balances are preserved.",
      (report) => report.hospital.financials.cash,
    ),
    currentRatioSeries(reports),
    liabilitiesAssetsSeries(reports),
    utilizationSeries(reports),
    scoreHistorySeries(reports),
  ];
}

export function pairedRevenueExpense(reports: HospitalView[]): {
  periods: { reportId: string; end: string; start: string | null; revenue: number | null; expenses: number | null }[];
  note: string;
} {
  const ordered = orderedReports(reports);
  const comparability = reportsComparable(ordered);
  return {
    note: comparability.note,
    periods: ordered.map((report) => ({
      reportId: report.hospital.id,
      start: report.hospital.fiscalYearStart,
      end: report.hospital.fiscalYearEnd,
      revenue: report.hospital.financials.netPatientRevenue,
      expenses: report.hospital.financials.operatingExpenses,
    })),
  };
}

export function safePercentChange(current: number | null, previous: number | null): number | null {
  return financeSafePercentChange(current, previous);
}

export function mainContributors(
  view: HospitalView,
): { id: string; label: string; note: string }[] {
  return view.financial.factors
    .filter((factor) => factor.available && factor.normalizedRisk !== null && factor.normalizedRisk >= 50)
    .map((factor) => ({
      id: factor.id,
      label: factor.metric,
      note:
        factor.id === "expense_pressure"
          ? "Patient-service expenses were high relative to net patient revenue."
          : factor.id === "leverage"
            ? "Liabilities were high relative to reported assets."
            : factor.id === "liquidity"
              ? "Cash was low relative to patient-service expenses, or cash was excluded."
              : factor.id === "current_ratio"
                ? "Current assets were low relative to current liabilities."
                : factor.id === "patient_volume"
                  ? "Inpatient utilization was low relative to bed days available."
                  : "This available factor raised the experimental score.",
    }));
}
