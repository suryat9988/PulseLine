import { formatWhatChangedAnswer, MEASURES, whatChangedBrief } from "../finance/index.ts";
import { flaggedExplanations } from "../score-financial.ts";
import { SCENARIO_LIMIT } from "../scenario/whatif.ts";
import { fiscalLabel, moneyExact, moneyHeadline } from "../../src/ui/format.ts";
import { interpretQuestion, totalClarificationOptions, yearClarification } from "./interpret.ts";
import { parseApprovedExplanationChoice, RESTATE_EXPLANATION } from "./presentation.ts";
import {
  EXPERIMENTAL_NOTE,
  UNAVAILABLE_STATEMENT,
  type AnswerPeriod,
  type AnswerSource,
  type AskContext,
  type AskIntent,
  type InterpretedQuestion,
  type PulseAnswer,
  type ScenarioExport,
} from "./types.ts";

const METHOD_LIMIT =
  "Available in PulseLine. Historical CMS figures are not live conditions. Methodology is on the main page.";

function periodFromView(view: NonNullable<AskContext["selectedReport"]>): AnswerPeriod {
  return {
    start: view.hospital.fiscalYearStart,
    end: view.hospital.fiscalYearEnd,
    fileCohort: view.hospital.fileCohort,
  };
}

function cmsSource(view: NonNullable<AskContext["selectedReport"]>): AnswerSource {
  return {
    label: view.hospital.sourceId ?? "CMS cost report",
    url: view.hospital.sourceUrl,
    reportId: view.hospital.reportRecordId,
  };
}

function eventSources(context: AskContext): AnswerSource[] {
  const seen = new Set<string>();
  const sources: AnswerSource[] = [];
  for (const event of context.events) {
    for (const source of event.sources) {
      if (seen.has(source.sourceId)) continue;
      seen.add(source.sourceId);
      sources.push({ label: source.title, url: source.url, reportId: null });
    }
  }
  return sources;
}

function observationSources(context: AskContext, domain: "community" | "workforce_access"): AnswerSource[] {
  const seen = new Set<string>();
  const sources: AnswerSource[] = [];
  for (const item of context.observations.filter((row) => row.domain === domain)) {
    for (const source of item.sources) {
      if (seen.has(source.sourceId)) continue;
      seen.add(source.sourceId);
      sources.push({ label: source.title, url: source.url, reportId: null });
    }
  }
  return sources;
}

function publicationLimits(context: AskContext): string[] {
  const limits: string[] = [];
  for (const event of context.events) {
    for (const source of event.sources) {
      if (source.publicationDate === null) {
        limits.push(
          "At least one cited source has no publication date. A missing publication date is not evidence the source was available before the event.",
        );
        return limits;
      }
    }
  }
  return limits;
}

function baseAnswer(
  context: AskContext,
  question: string,
  intent: AskIntent,
  patch: Partial<PulseAnswer>,
): PulseAnswer {
  return {
    id: `${context.hospitalId}:${intent}:${patch.status ?? "complete"}:${question}`,
    hospitalId: context.hospitalId,
    hospitalName: context.hospitalName,
    question,
    intent,
    statement: patch.statement ?? UNAVAILABLE_STATEMENT,
    explanation: null,
    periodLabel: patch.periodLabel ?? null,
    periods: patch.periods ?? [],
    kind: patch.kind ?? "reported",
    status: patch.status ?? "unavailable",
    mode: "data_lookup",
    sources: patch.sources ?? [],
    limitations: patch.limitations ?? [METHOD_LIMIT],
    clarificationOptions: patch.clarificationOptions ?? [],
    suggestedFollowUps: patch.suggestedFollowUps ?? [],
    lockedFacts: patch.lockedFacts ?? [],
    headline: patch.headline ?? null,
    scenario: patch.scenario ?? null,
  };
}

function resolveReport(context: AskContext, interpreted: InterpretedQuestion) {
  if (!context.selectedReport) return null;
  if (interpreted.year != null && interpreted.yearKind === "file_cohort") {
    return context.reports.find((report) => report.hospital.fileCohort === interpreted.year) ?? null;
  }
  if (interpreted.year != null && interpreted.yearKind === "fiscal_end") {
    return (
      context.reports.find((report) => report.hospital.fiscalYearEnd.startsWith(String(interpreted.year))) ??
      context.selectedReport
    );
  }
  return context.selectedReport;
}


function answerWhyScore(context: AskContext, question: string): PulseAnswer {
  const view = context.selectedReport;
  if (context.kind !== "scored" || !view) {
    return baseAnswer(context, question, "why_score", {
      status: "unavailable",
      statement: UNAVAILABLE_STATEMENT,
      limitations: [
        "Financial data pending. No CCN, license ID, cost-report financials, or stress score were invented for this case.",
        METHOD_LIMIT,
      ],
    });
  }
  const score = view.financial.score;
  const reasons = flaggedExplanations(view.financial);
  const period = fiscalLabel(view.hospital.fiscalYearStart, view.hospital.fiscalYearEnd);
  const statement =
    score === null
      ? `${context.hospitalName} has no PulseLine score for ${period} because no financial factor could be scored.`
      : `${context.hospitalName} received a PulseLine score of ${score} (${view.financial.status}) for ${period}. ${reasons.join(" ")}`;
  return baseAnswer(context, question, "why_score", {
    status: "complete",
    kind: "calculated",
    statement,
    periodLabel: period,
    periods: [periodFromView(view)],
    sources: [cmsSource(view)],
    lockedFacts: score === null ? ["score=null"] : [`score=${score}`, `status=${view.financial.status}`],
    limitations: [
      "The score is an experimental interpretation of available factors on this historical report. It is not acquisition attractiveness, enterprise value, or a probability of closure or bankruptcy.",
      METHOD_LIMIT,
    ],
    suggestedFollowUps: ["What information is missing or excluded?"],
  });
}

function answerMoney(
  context: AskContext,
  question: string,
  intent: "net_patient_revenue" | "operating_expenses" | "cash",
  interpreted: InterpretedQuestion,
): PulseAnswer {
  if (context.kind !== "scored" || !context.selectedReport) {
    return baseAnswer(context, question, intent, {
      status: "unavailable",
      statement: UNAVAILABLE_STATEMENT,
      limitations: [
        "Financial data pending. PulseLine does not invent revenue, expenses, cash, or a score for this case.",
        METHOD_LIMIT,
      ],
    });
  }
  const view = resolveReport(context, interpreted);
  if (!view) {
    return baseAnswer(context, question, intent, { status: "unavailable", statement: UNAVAILABLE_STATEMENT });
  }
  const value =
    intent === "net_patient_revenue"
      ? view.hospital.financials.netPatientRevenue
      : intent === "operating_expenses"
        ? view.hospital.financials.operatingExpenses
        : view.hospital.financials.cash;
  const label =
    intent === "net_patient_revenue"
      ? "Net Patient Revenue"
      : intent === "operating_expenses"
        ? "Less Total Operating Expense"
        : "Cash on Hand and in Banks";
  const period = fiscalLabel(view.hospital.fiscalYearStart, view.hospital.fiscalYearEnd);
  if (value === null) {
    return baseAnswer(context, question, intent, {
      status: "unavailable",
      statement: UNAVAILABLE_STATEMENT,
      periodLabel: period,
      periods: [periodFromView(view)],
      sources: [cmsSource(view)],
      limitations: [`${label} is missing in this report. Missing is not the same as zero.`, METHOD_LIMIT],
    });
  }
  const exact = moneyExact(value);
  const zeroNote = value === 0 ? " This is a reported zero, not a missing value." : "";
  const negativeNote = value < 0 ? " The negative sign is preserved from the CMS report." : "";
  return baseAnswer(context, question, intent, {
    status: "complete",
    kind: "reported",
    statement: `${context.hospitalName} reported ${label} of ${exact} for ${period}.${zeroNote}${negativeNote}`,
    periodLabel: period,
    periods: [periodFromView(view)],
    sources: [cmsSource(view)],
    lockedFacts: [`${intent}=${value}`, exact],
    headline: moneyHeadline(value),
    limitations: [METHOD_LIMIT],
    suggestedFollowUps:
      intent === "net_patient_revenue" && context.reports.length > 1
        ? ["How did revenue change from the previous comparable report?"]
        : [],
  });
}

function answerRevenueChange(context: AskContext, question: string, interpreted: InterpretedQuestion): PulseAnswer {
  const selected = context.kind === "scored" ? resolveReport(context, interpreted) : null;
  const brief = whatChangedBrief({
    view: selected,
    reports: context.reports,
    pending: context.kind !== "scored" || !context.selectedReport,
    hospitalName: context.hospitalName,
  });
  const formatted = formatWhatChangedAnswer(brief);
  if (brief.status === "pending") {
    return baseAnswer(context, question, "revenue_change", {
      status: "unavailable",
      statement: formatted.statement,
      limitations: [...formatted.limitations, METHOD_LIMIT],
      lockedFacts: formatted.lockedFacts,
    });
  }
  const previousView =
    selected && brief.previousPeriod
      ? context.reports.find((report) => report.hospital.fiscalYearEnd === brief.previousPeriod?.end) ?? null
      : null;
  const nprPrevious = previousView?.hospital.financials.netPatientRevenue ?? null;
  const nprCurrent = selected?.hospital.financials.netPatientRevenue ?? null;
  return baseAnswer(context, question, "revenue_change", {
    status: "complete",
    kind: "calculated",
    statement: formatted.statement,
    periodLabel:
      brief.previousPeriod && brief.currentPeriod
        ? `${brief.previousPeriod.label} → ${brief.currentPeriod.label}`
        : brief.currentPeriod?.label ?? null,
    periods: [previousView, selected].filter((item): item is NonNullable<typeof item> => item != null).map(periodFromView),
    sources: brief.sources,
    lockedFacts: [
      ...formatted.lockedFacts,
      nprPrevious !== null ? `previous=${nprPrevious}` : "previous=null",
      nprCurrent !== null ? `current=${nprCurrent}` : "current=null",
      nprPrevious !== null && nprCurrent !== null ? `delta=${nprCurrent - nprPrevious}` : "delta=null",
      nprPrevious !== null ? moneyExact(nprPrevious) : "previous_npr=missing",
      nprCurrent !== null ? moneyExact(nprCurrent) : "current_npr=missing",
    ],
    limitations: [...formatted.limitations, METHOD_LIMIT],
    suggestedFollowUps: ["What evidence should I verify next?"],
  });
}

function answerMissing(context: AskContext, question: string): PulseAnswer {
  if (context.kind !== "scored" || !context.selectedReport) {
    return baseAnswer(context, question, "missing_excluded", {
      status: "complete",
      kind: "reported",
      statement: `${context.hospitalName} is a research case with financial coverage pending. No cost-report financials or score are available in PulseLine.`,
      limitations: ["Financial data pending must not produce a score or a reassuring status.", METHOD_LIMIT],
    });
  }
  const view = context.selectedReport;
  const period = fiscalLabel(view.hospital.fiscalYearStart, view.hospital.fiscalYearEnd);
  const missing = view.hospital.dataQuality.missingFields;
  const exclusions = view.financial.exclusions;
  const unsupported = view.financial.factors.filter((factor) => factor.availability === "unsupported").map((factor) => factor.metric);
  const parts = [
    missing.length ? `Missing fields: ${missing.join(", ")}.` : "No missing metric names are recorded on this report.",
    exclusions.length ? `Excluded calculations: ${exclusions.join(" ")}` : "No ratio exclusions are recorded.",
    unsupported.length ? `Unsupported calculations: ${unsupported.join(", ")}.` : "",
  ].filter(Boolean);
  return baseAnswer(context, question, "missing_excluded", {
    status: "complete",
    kind: "reported",
    statement: `For ${context.hospitalName} (${period}): ${parts.join(" ")}`,
    periodLabel: period,
    periods: [periodFromView(view)],
    sources: [cmsSource(view)],
    limitations: ["Missing is not zero. Negative published balances are preserved and may make a ratio uninterpretable.", METHOD_LIMIT],
  });
}

function categoryPhrase(category: string): string {
  if (category === "property_transaction") return "a property transaction, not a verified provider CHOW";
  if (category === "parent_bankruptcy") return "a parent bankruptcy event, not a verified facility bankruptcy";
  if (category === "parent_restructuring") return "a parent restructuring event, not a verified facility outcome";
  return "an acquisition or rename record";
}

function answerEvents(context: AskContext, question: string): PulseAnswer {
  if (context.events.length === 0) {
    return baseAnswer(context, question, "structural_events", {
      status: "unavailable",
      statement: UNAVAILABLE_STATEMENT,
      limitations: [
        "No sourced structural events are attached in the current PulseLine ledger. That is not a finding that no events exist.",
        METHOD_LIMIT,
      ],
    });
  }
  const groups = new Map<string, typeof context.events>();
  for (const event of context.events) {
    const list = groups.get(event.eventGroup) ?? [];
    list.push(event);
    groups.set(event.eventGroup, list);
  }
  const lines: string[] = [];
  for (const groupEvents of groups.values()) {
    const labels = groupEvents.map((event) => `${event.eventSubtype.replaceAll("_", " ")} (${categoryPhrase(event.eventCategory)})`);
    if (groupEvents[0]?.eventCategory === "acquisition") {
      lines.push(
        `${labels.join("; ")}. Acquisition and rename share one event group and are not counted twice.`,
      );
    } else {
      lines.push(labels.join("; "));
    }
  }
  return baseAnswer(context, question, "structural_events", {
    status: "complete",
    kind: "reported",
    statement: `Documented events for ${context.hospitalName}: ${lines.join(" ")}`,
    sources: eventSources(context),
    limitations: [
      ...publicationLimits(context),
      "Event dates are not fiscal periods or CMS file cohorts.",
      METHOD_LIMIT,
    ],
  });
}

function scenarioExportFrom(context: AskContext): ScenarioExport | null {
  const scenario = context.scenario;
  if (!scenario?.enabled) return null;
  return {
    baselinePeriod: scenario.baselinePeriod,
    revenueChangePct: scenario.inputs.revenueChangePct,
    expenseChangePct: scenario.inputs.expenseChangePct,
    baselineRevenue: scenario.baselineRevenue,
    baselineExpenses: scenario.baselineExpenses,
    scenarioRevenue: scenario.scenarioRevenue,
    scenarioExpenses: scenario.scenarioExpenses,
    scenarioBalance: scenario.scenarioBalance,
    baselineBalance: scenario.baselineBalance,
    balanceChange: scenario.balanceChange,
    revenueToEqualExpenses: scenario.revenueToEqualExpenses,
    requiredRevenueChangePct: scenario.requiredRevenueChangePct,
    formulas: scenario.formulas,
    limitation: SCENARIO_LIMIT,
  };
}

function answerScenario(context: AskContext, question: string): PulseAnswer {
  if (context.kind !== "scored" || !context.selectedReport) {
    return baseAnswer(context, question, "whatif_scenario", {
      status: "unavailable",
      statement: UNAVAILABLE_STATEMENT,
      limitations: ["What-if is disabled while financial data is pending.", METHOD_LIMIT],
    });
  }
  const scenario = context.scenario;
  if (!scenario?.enabled || scenario.scenarioRevenue === null || scenario.scenarioExpenses === null || scenario.scenarioBalance === null) {
    return baseAnswer(context, question, "whatif_scenario", {
      status: "unavailable",
      statement: UNAVAILABLE_STATEMENT,
      limitations: [scenario?.disabledReason ?? "No supported scenario is available for this report.", METHOD_LIMIT],
    });
  }
  const statement = `${context.hospitalName} scenario for ${scenario.baselinePeriod}: assumed net patient revenue ${scenario.inputs.revenueChangePct >= 0 ? "+" : ""}${scenario.inputs.revenueChangePct}% and patient-service expenses ${scenario.inputs.expenseChangePct >= 0 ? "+" : ""}${scenario.inputs.expenseChangePct}% produces scenario revenue ${moneyExact(scenario.scenarioRevenue)}, scenario expenses ${moneyExact(scenario.scenarioExpenses)}, and a simplified patient-service scenario balance of ${moneyExact(scenario.scenarioBalance)}.`;
  return baseAnswer(context, question, "whatif_scenario", {
    status: "complete",
    kind: "scenario",
    statement,
    periodLabel: scenario.baselinePeriod,
    periods: [periodFromView(context.selectedReport)],
    sources: scenario.sources,
    headline: moneyHeadline(scenario.scenarioBalance),
    lockedFacts: [
      `scenarioRevenue=${scenario.scenarioRevenue}`,
      `scenarioExpenses=${scenario.scenarioExpenses}`,
      `scenarioBalance=${scenario.scenarioBalance}`,
      moneyExact(scenario.scenarioRevenue),
      moneyExact(scenario.scenarioExpenses),
      moneyExact(scenario.scenarioBalance),
    ],
    scenario: scenarioExportFrom(context),
    limitations: [SCENARIO_LIMIT, METHOD_LIMIT],
  });
}

function answerCommunity(context: AskContext, question: string): PulseAnswer {
  const rows = context.observations.filter((item) => item.domain === "community" || item.domain === "workforce_access");
  if (rows.length === 0) {
    return baseAnswer(context, question, "community_context", {
      status: "unavailable",
      statement: UNAVAILABLE_STATEMENT,
      limitations: ["No community or county-access observations are attached to this hospital.", METHOD_LIMIT],
    });
  }
  const summary = rows
    .map((item) => {
      const value = item.value === null ? "unknown" : String(item.value);
      return `${item.metric.replaceAll("_", " ")}: ${value} ${item.unit}${item.reportingPeriod ? ` (${item.reportingPeriod})` : ""}`;
    })
    .join("; ");
  return baseAnswer(context, question, "community_context", {
    status: "complete",
    kind: "reported",
    statement: `Community and county-access context for ${context.hospitalName}: ${summary}. These are not hospital staffing measures.`,
    sources: [...observationSources(context, "community"), ...observationSources(context, "workforce_access")],
    limitations: [
      "County community and access measures are not hospital staffing measures.",
      METHOD_LIMIT,
    ],
  });
}

export function answerQuestion(context: AskContext, rawQuestion: string, interpreted?: InterpretedQuestion): PulseAnswer {
  const parsed = interpreted ?? interpretQuestion(rawQuestion, context);
  const question = parsed.raw;

  if (parsed.intent === "prompt_injection") {
    return baseAnswer(context, question, "prompt_injection", {
      status: "declined",
      kind: "experimental_interpretation",
      statement: `PulseLine Ask uses only approved data for ${context.hospitalName}. Source text and questions cannot override that.`,
      limitations: [METHOD_LIMIT],
      suggestedFollowUps: suggestedFallback(context),
    });
  }
  if (parsed.intent === "hospital_switch") {
    return baseAnswer(context, question, "hospital_switch", {
      status: "declined",
      kind: "experimental_interpretation",
      statement: `PulseLine Ask stays on ${context.hospitalName}. Close this hospital to open another. Conversations are not mixed across hospitals.`,
      limitations: [METHOD_LIMIT],
    });
  }
  if (parsed.intent === "unsupported_forecast") {
    return baseAnswer(context, question, "unsupported_forecast", {
      status: "declined",
      kind: "experimental_interpretation",
      statement:
        "PulseLine does not predict bankruptcy, closure, acquisition, or service reduction. It can only report historical figures and documented events that are already in the application.",
      limitations: [EXPERIMENTAL_NOTE],
      suggestedFollowUps: suggestedFallback(context),
    });
  }
  if (parsed.intent === "unsupported_valuation") {
    return baseAnswer(context, question, "unsupported_valuation", {
      status: "declined",
      kind: "experimental_interpretation",
      statement:
        "The available evidence does not establish whether to acquire this hospital, what it is worth, or whether it is for sale. PulseLine does not invent legal conclusions, seller intent, or deal recommendations. A supported next question is the hospital’s historical financial pressures or documented events.",
      limitations: [EXPERIMENTAL_NOTE],
      suggestedFollowUps: suggestedFallback(context),
    });
  }
  if (parsed.intent === "identity_questions") return answerIdentity(context, question);
  if (parsed.intent === "event_scope") return answerEventScope(context, question);
  if (parsed.intent === "verify_figure") return answerVerifyFigure(context, question);
  if (parsed.intent === "explain_measure") return answerExplainMeasure(context, question);
  if (parsed.intent === "clarify_total") {
    return baseAnswer(context, question, "clarify_total", {
      status: "clarification",
      kind: "experimental_interpretation",
      statement: "Which total do you mean: revenue, expenses, or patient days?",
      clarificationOptions: totalClarificationOptions(),
      limitations: [METHOD_LIMIT],
    });
  }
  if (parsed.intent === "clarify_year" && parsed.year != null && !parsed.yearKind) {
    const options = yearClarification(context, parsed.year) ?? [];
    return baseAnswer(context, question, "clarify_year", {
      status: "clarification",
      kind: "experimental_interpretation",
      statement: `Do you mean the report ending in ${parsed.year} or CMS file cohort ${parsed.year}?`,
      clarificationOptions: options,
      limitations: ["Historical fiscal periods, CMS file cohorts, publication dates, and event dates are different concepts."],
    });
  }
  if (parsed.intent === "unknown") {
    if (parsed.metric === "inpatient_days") {
      const view = context.selectedReport;
      const days = view?.hospital.financials.inpatientDays ?? null;
      if (context.kind !== "scored" || !view || days === null) {
        return baseAnswer(context, question, "unknown", { status: "unavailable", statement: UNAVAILABLE_STATEMENT });
      }
      const period = fiscalLabel(view.hospital.fiscalYearStart, view.hospital.fiscalYearEnd);
      return baseAnswer(context, question, "unknown", {
        status: "complete",
        kind: "reported",
        statement: `${context.hospitalName} reported Total Days of ${days.toLocaleString("en-US")} for ${period}.`,
        periodLabel: period,
        periods: [periodFromView(view)],
        sources: [cmsSource(view)],
        lockedFacts: [`inpatient_days=${days}`],
        limitations: [METHOD_LIMIT],
      });
    }
    return baseAnswer(context, question, "unknown", {
      status: "unavailable",
      statement: UNAVAILABLE_STATEMENT,
      suggestedFollowUps: suggestedFallback(context),
      limitations: [METHOD_LIMIT],
    });
  }
  if (parsed.intent === "why_score") return answerWhyScore(context, question);
  if (parsed.intent === "net_patient_revenue") return answerMoney(context, question, "net_patient_revenue", parsed);
  if (parsed.intent === "operating_expenses") return answerMoney(context, question, "operating_expenses", parsed);
  if (parsed.intent === "cash") return answerMoney(context, question, "cash", parsed);
  if (parsed.intent === "revenue_change") return answerRevenueChange(context, question, parsed);
  if (parsed.intent === "missing_excluded") return answerMissing(context, question);
  if (parsed.intent === "structural_events") return answerEvents(context, question);
  if (parsed.intent === "community_context") return answerCommunity(context, question);
  if (parsed.intent === "whatif_scenario") return answerScenario(context, question);
  return baseAnswer(context, question, parsed.intent, { status: "unavailable", statement: UNAVAILABLE_STATEMENT });
}

function answerIdentity(context: AskContext, question: string): PulseAnswer {
  const view = context.selectedReport;
  const parts: string[] = [];
  if (context.kind !== "scored" || !view) {
    parts.push(`${context.hospitalName} is a research case. Financial identity fields and a CCN were not invented.`);
    if (context.research?.ccnAtEvent == null) parts.push("Event-time CCN is unknown.");
    if (context.research?.providerChow === "unknown") parts.push("Provider CHOW is recorded as unknown.");
  } else {
    if (view.hospital.historicalCcn && view.hospital.currentCcn && view.hospital.historicalCcn !== view.hospital.currentCcn) {
      parts.push(`Historical CCN ${view.hospital.historicalCcn} differs from current CCN ${view.hospital.currentCcn}.`);
    }
    if (view.hospital.dataQuality.addressMismatch) {
      parts.push("A historical versus current street-address discrepancy is recorded and is not a workforce change.");
    }
    if (view.hospital.dataQuality.identityStatus === "unresolved") {
      parts.push("Identity review is unresolved.");
    }
    if (parts.length === 0) {
      parts.push("PulseLine has not flagged an identity discrepancy on the selected report. That is not a completed legal identity audit.");
    }
  }
  return baseAnswer(context, question, "identity_questions", {
    status: "complete",
    kind: "reported",
    statement: parts.join(" "),
    periodLabel: view ? fiscalLabel(view.hospital.fiscalYearStart, view.hospital.fiscalYearEnd) : null,
    periods: view ? [periodFromView(view)] : [],
    sources: view ? [cmsSource(view)] : [],
    limitations: [METHOD_LIMIT],
  });
}

function answerEventScope(context: AskContext, question: string): PulseAnswer {
  if (context.events.length === 0) {
    return baseAnswer(context, question, "event_scope", {
      status: "unavailable",
      statement: UNAVAILABLE_STATEMENT,
      limitations: [
        "No sourced structural events are attached in the current PulseLine ledger. That is not a finding that no events exist.",
        METHOD_LIMIT,
      ],
    });
  }
  const lines = context.events.map((event) => {
    if (event.scope === "property") return `${event.eventSubtype.replaceAll("_", " ")} is a property-scope record, not a verified provider CHOW.`;
    if (event.eventStatus === "verified_parent_event") {
      return `${event.eventSubtype.replaceAll("_", " ")} is a parent-scope record, not a verified facility bankruptcy.`;
    }
    return `${event.eventSubtype.replaceAll("_", " ")} is recorded at ${event.scope.replaceAll("_", " ")} scope.`;
  });
  return baseAnswer(context, question, "event_scope", {
    status: "complete",
    kind: "reported",
    statement: `Event scope for ${context.hospitalName}: ${lines.join(" ")}`,
    sources: eventSources(context),
    limitations: [...publicationLimits(context), METHOD_LIMIT],
  });
}

function answerVerifyFigure(context: AskContext, question: string): PulseAnswer {
  if (context.kind !== "scored" || !context.selectedReport) {
    return baseAnswer(context, question, "verify_figure", {
      status: "complete",
      kind: "reported",
      statement: `${context.hospitalName} has financial data pending. Verify source documents before treating any later figure as available in PulseLine.`,
      limitations: [METHOD_LIMIT],
    });
  }
  const view = context.selectedReport;
  const period = fiscalLabel(view.hospital.fiscalYearStart, view.hospital.fiscalYearEnd);
  const statement = `Before relying on a ${context.hospitalName} figure for ${period}, confirm the reporting-entity versus parent consolidation scope, the fiscal dates rather than the CMS file cohort, missing or excluded factors, and that a scenario result is not reported data.`;
  return baseAnswer(context, question, "verify_figure", {
    status: "complete",
    kind: "experimental_interpretation",
    statement,
    periodLabel: period,
    periods: [periodFromView(view)],
    sources: [cmsSource(view)],
    limitations: [METHOD_LIMIT],
  });
}

function answerExplainMeasure(context: AskContext, question: string): PulseAnswer {
  const lower = question.toLowerCase();
  const measure = lower.includes("expense")
    ? MEASURES.patient_service_expenses
    : lower.includes("cash")
      ? MEASURES.cash
      : lower.includes("current ratio")
        ? MEASURES.current_ratio
        : lower.includes("margin") || lower.includes("result")
          ? MEASURES.patient_service_result_ratio
          : MEASURES.net_patient_revenue;
  const view = context.selectedReport;
  const excluded = view?.financial.factors.find((factor) =>
    lower.includes("excluded") && (factor.availability === "invalid" || factor.availability === "unsupported"),
  );
  const statement = excluded
    ? `${measure.label} for ${context.hospitalName}: ${measure.definition} ${measure.not} ${excluded.metric} was excluded because ${excluded.exclusion ?? "the published value is not interpretable."}`
    : `${measure.label} for ${context.hospitalName}: ${measure.definition} ${measure.not}`;
  return baseAnswer(context, question, "explain_measure", {
    status: "complete",
    kind: "experimental_interpretation",
    statement,
    periodLabel: view ? fiscalLabel(view.hospital.fiscalYearStart, view.hospital.fiscalYearEnd) : null,
    periods: view ? [periodFromView(view)] : [],
    sources: view ? [cmsSource(view)] : [],
    limitations: [METHOD_LIMIT],
  });
}

function suggestedFallback(context: AskContext): string[] {
  if (context.kind === "research") {
    return ["What transactions or parent-company events are documented?", "What identity questions remain unresolved?"];
  }
  return ["What financial pressures are visible in the available reports?", "Which figures are missing or excluded?"];
}

export function applyModelExplanation(
  answer: PulseAnswer,
  explanation: string | null,
  options: { modelRan?: boolean } = {},
): PulseAnswer {
  if (answer.status !== "complete") {
    return { ...answer, mode: "data_lookup", explanation: null };
  }
  if (!explanation) {
    return {
      ...answer,
      mode: options.modelRan ? "on_device_unused" : "data_lookup",
      explanation: null,
    };
  }
  const choice = parseApprovedExplanationChoice(explanation);
  if (!choice) {
    return { ...answer, mode: "on_device_unused", explanation: null };
  }
  return {
    ...answer,
    mode: "on_device_explanation",
    explanation: RESTATE_EXPLANATION,
  };
}

export function answerKnownIntent(context: AskContext, question: string, intent: AskIntent): PulseAnswer {
  return answerQuestion(context, question, { intent, raw: question });
}
