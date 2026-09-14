import type { AskContext, AskIntent } from "./types.ts";

export interface SuggestedQuestion {
  id: string;
  intent: AskIntent;
  label: string;
  question: string;
}

export function suggestedQuestions(context: AskContext): SuggestedQuestion[] {
  const scored = context.kind === "scored" && context.selectedReport !== null;
  const items: SuggestedQuestion[] = [];

  if (scored) {
    items.push({
      id: "explain_measure",
      intent: "explain_measure",
      label: "Explain this measure",
      question: "Explain this financial measure.",
    });
    items.push({
      id: "why_score",
      intent: "why_score",
      label: "Score contributors",
      question: "What contributes to the concern score?",
    });
    if (context.reports.length > 1) {
      items.push({
        id: "npr_change",
        intent: "revenue_change",
        label: "What changed",
        question: "What changed between these reports?",
      });
    }
    items.push({
      id: "excluded",
      intent: "explain_measure",
      label: "Why excluded",
      question: "Why was this ratio excluded?",
    });
    items.push({
      id: "verify_figure",
      intent: "verify_figure",
      label: "What to verify",
      question: "What evidence should I verify next?",
    });
    if (context.scenario?.enabled) {
      items.push({
        id: "whatif",
        intent: "whatif_scenario",
        label: "Explain my scenario",
        question: "Explain my scenario assumptions and results.",
      });
    }
  }

  if (!scored) {
    items.unshift({
      id: "npr_change_pending",
      intent: "revenue_change",
      label: "What changed",
      question: "What changed between these reports?",
    });
  }

  items.push({
    id: "missing",
    intent: "missing_excluded",
    label: "Missing or excluded",
    question: "Which figures are missing or excluded?",
  });
  items.push({
    id: "events",
    intent: "structural_events",
    label: "Documented transactions",
    question: "What transactions or parent-company events are documented?",
  });
  items.push({
    id: "event_scope",
    intent: "event_scope",
    label: "Event scope",
    question: "Is this event about the provider, parent, or property?",
  });
  items.push({
    id: "identity",
    intent: "identity_questions",
    label: "Identity questions",
    question: "What identity questions remain unresolved?",
  });
  items.push({
    id: "community",
    intent: "community_context",
    label: "Community context",
    question: "What community context is available?",
  });

  return items;
}
