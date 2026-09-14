import { longFiscalRange } from "../../src/ui/format.ts";
import type { AnswerMode, AnswerPeriod, PulseAnswer } from "./types.ts";

export const APPROVED_EXPLANATION_CHOICES = ["restate"] as const;
export type ApprovedExplanationChoice = (typeof APPROVED_EXPLANATION_CHOICES)[number];

export const RESTATE_EXPLANATION =
  "This restates the PulseLine answer above. It adds no new figures, percentages, dates, hospitals, or conclusions.";

export function parseApprovedExplanationChoice(text: string): ApprovedExplanationChoice | null {
  const trimmed = text.trim();
  if (trimmed === "restate") return "restate";
  try {
    const parsed = JSON.parse(trimmed) as { choice?: unknown };
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      parsed.choice === "restate" &&
      Object.keys(parsed).length === 1
    ) {
      return "restate";
    }
  } catch {
    return null;
  }
  return null;
}

export function answerModeLabel(mode: AnswerMode): string {
  if (mode === "on_device_explanation") {
    return "On-device helper ran. PulseLine rendered an approved template from stored facts.";
  }
  if (mode === "on_device_unused") {
    return "On-device helper ran. PulseLine kept the deterministic answer because the generated text was not an approved template.";
  }
  return "Data lookup. Generative AI did not run.";
}

export function formatPeriodValue(period: AnswerPeriod): string {
  return longFiscalRange(period.start, period.end);
}

export function answerPeriodRows(answer: PulseAnswer): { label: string; value: string }[] {
  if (answer.periods.length >= 2) {
    const earlier = answer.periods[0]!;
    const selected = answer.periods[1]!;
    return [
      { label: "Earlier report", value: formatPeriodValue(earlier) },
      { label: "Selected report", value: formatPeriodValue(selected) },
    ];
  }
  if (answer.periods[0]) {
    return [{ label: "Fiscal period", value: formatPeriodValue(answer.periods[0]) }];
  }
  if (answer.periodLabel) {
    return [{ label: "Fiscal period", value: answer.periodLabel }];
  }
  return [];
}

export function compactPeriodLabel(answer: PulseAnswer): string | null {
  const rows = answerPeriodRows(answer);
  if (rows.length === 0) return answer.periodLabel;
  if (rows.length === 1) return rows[0]!.value;
  return rows.map((row) => `${row.label}: ${row.value}`).join(" · ");
}

