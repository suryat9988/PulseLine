import { answerModeLabel, answerPeriodRows, compactPeriodLabel } from "./presentation.ts";
import { EXPERIMENTAL_NOTE, type AnswerMode, type PulseAnswer } from "./types.ts";

export interface ExportAnswer {
  question: string;
  statement: string;
  hospitalName: string;
  periodLabel: string | null;
  periodRows: { label: string; value: string }[];
  mode: AnswerMode;
  modeLabel: string;
  explanation: string | null;
  sources: { label: string; url: string | null; reportId: string | null }[];
  limitations: string[];
  kind: PulseAnswer["kind"];
  scenario: PulseAnswer["scenario"];
}

export interface ExportDocument {
  hospitalName: string;
  exportedAt: string;
  experimentalNote: string;
  answers: ExportAnswer[];
}

export type ExportResult =
  | { ok: true; document: ExportDocument }
  | { ok: false; reason: "empty" | "incomplete" };

export function canExportAnswer(answer: PulseAnswer): boolean {
  return answer.status === "complete";
}

export function buildExportDocument(
  hospitalName: string,
  answers: PulseAnswer[],
  now = new Date(),
): ExportResult {
  if (answers.length === 0) return { ok: false, reason: "empty" };
  if (answers.some((answer) => !canExportAnswer(answer))) return { ok: false, reason: "incomplete" };
  return {
    ok: true,
    document: {
      hospitalName,
      exportedAt: now.toISOString().slice(0, 10),
      experimentalNote: EXPERIMENTAL_NOTE,
      answers: answers.map((answer) => ({
        question: answer.question,
        statement: answer.statement,
        hospitalName: answer.hospitalName,
        periodLabel: compactPeriodLabel(answer),
        periodRows: answerPeriodRows(answer),
        mode: answer.mode,
        modeLabel: answerModeLabel(answer.mode),
        explanation: answer.mode === "on_device_explanation" ? answer.explanation : null,
        sources: answer.sources,
        limitations: answer.limitations,
        kind: answer.kind,
        scenario: answer.scenario,
      })),
    },
  };
}

export function formatAnswerText(answer: PulseAnswer): string {
  const sources = answer.sources
    .map((source) => {
      const report = source.reportId ? ` (report ${source.reportId})` : "";
      const url = source.url ? ` ${source.url}` : "";
      return `${source.label}${report}${url}`;
    })
    .join("\n");
  const periodRows = answerPeriodRows(answer);
  const periods = periodRows.map((row) => `${row.label}: ${row.value}`).join("\n");
  const calculations = answer.lockedFacts.length ? `Calculations:\n${answer.lockedFacts.join("\n")}` : null;
  return [
    `Hospital: ${answer.hospitalName}`,
    periods ? `Reporting periods:\n${periods}` : answer.periodLabel ? `Period: ${answer.periodLabel}` : null,
    `Question: ${answer.question}`,
    `Answer: ${answer.statement}`,
    answerModeLabel(answer.mode),
    answer.mode === "on_device_explanation" && answer.explanation ? `Explanation: ${answer.explanation}` : null,
    `Kind: ${answer.kind.replaceAll("_", " ")}`,
    calculations,
    answer.scenario
      ? [
          "Scenario assumptions:",
          `Baseline period: ${answer.scenario.baselinePeriod ?? "Unknown"}`,
          `Assumed net patient revenue change: ${answer.scenario.revenueChangePct}%`,
          `Assumed patient-service expense change: ${answer.scenario.expenseChangePct}%`,
          ...answer.scenario.formulas,
          answer.scenario.limitation,
        ].join("\n")
      : null,
    sources ? `Sources:\n${sources}` : null,
    answer.limitations.length ? `Limitations:\n${answer.limitations.join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
