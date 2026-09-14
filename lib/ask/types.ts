import type {
  EvidenceHospital,
  EvidenceObservation,
  HospitalView,
  StructuralEvent,
} from "../../src/types.ts";
import type { ScenarioResult } from "../scenario/whatif.ts";

export const ANSWER_KINDS = ["reported", "calculated", "experimental_interpretation", "scenario"] as const;
export type AnswerKind = (typeof ANSWER_KINDS)[number];

export const ANSWER_STATUSES = ["complete", "incomplete", "unavailable", "clarification", "declined"] as const;
export type AnswerStatus = (typeof ANSWER_STATUSES)[number];

export const ANSWER_MODES = ["data_lookup", "on_device_explanation", "on_device_unused"] as const;
export type AnswerMode = (typeof ANSWER_MODES)[number];

export const ASK_INTENTS = [
  "why_score",
  "net_patient_revenue",
  "revenue_change",
  "operating_expenses",
  "cash",
  "missing_excluded",
  "structural_events",
  "community_context",
  "clarify_total",
  "clarify_year",
  "unsupported_forecast",
  "unsupported_valuation",
  "identity_questions",
  "event_scope",
  "verify_figure",
  "explain_measure",
  "hospital_switch",
  "prompt_injection",
  "whatif_scenario",
  "unknown",
] as const;
export type AskIntent = (typeof ASK_INTENTS)[number];

export interface AnswerSource {
  label: string;
  url: string | null;
  reportId: string | null;
}

export interface AnswerPeriod {
  start: string | null;
  end: string;
  fileCohort: number | null;
}

export interface ClarificationOption {
  id: string;
  label: string;
  intent: AskIntent;
  year?: number;
  yearKind?: "fiscal_end" | "file_cohort";
  metric?: "net_patient_revenue" | "operating_expenses" | "inpatient_days";
}

export interface PulseAnswer {
  id: string;
  hospitalId: string;
  hospitalName: string;
  question: string;
  intent: AskIntent;
  statement: string;
  explanation: string | null;
  periodLabel: string | null;
  periods: AnswerPeriod[];
  kind: AnswerKind;
  status: AnswerStatus;
  mode: AnswerMode;
  sources: AnswerSource[];
  limitations: string[];
  clarificationOptions: ClarificationOption[];
  suggestedFollowUps: string[];
  lockedFacts: string[];
  headline: string | null;
  scenario: ScenarioExport | null;
}

export interface ScenarioExport {
  baselinePeriod: string | null;
  revenueChangePct: number;
  expenseChangePct: number;
  baselineRevenue: number | null;
  baselineExpenses: number | null;
  scenarioRevenue: number | null;
  scenarioExpenses: number | null;
  scenarioBalance: number | null;
  baselineBalance: number | null;
  balanceChange: number | null;
  revenueToEqualExpenses: number | null;
  requiredRevenueChangePct: number | null;
  formulas: string[];
  limitation: string;
}

export interface AskContext {
  kind: "scored" | "research";
  hospitalId: string;
  hospitalName: string;
  selectedReport: HospitalView | null;
  reports: HospitalView[];
  events: StructuralEvent[];
  observations: EvidenceObservation[];
  research: EvidenceHospital | null;
  otherHospitalNames: string[];
  scenario: ScenarioResult | null;
}

export interface InterpretedQuestion {
  intent: AskIntent;
  raw: string;
  year?: number;
  yearKind?: "fiscal_end" | "file_cohort";
  metric?: "net_patient_revenue" | "operating_expenses" | "inpatient_days";
}

export const UNAVAILABLE_STATEMENT = "That information is not available in the current PulseLine data.";

export const EXPERIMENTAL_NOTE =
  "PulseLine is experimental. These answers use only data available in this application and do not predict bankruptcy, closure, acquisition, or service reduction. They are evidence notes, not an investment recommendation or completed diligence report.";
