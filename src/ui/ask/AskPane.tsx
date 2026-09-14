import { useEffect, useMemo, useRef, useState } from "react";
import {
  answerKnownIntent,
  answerQuestion,
  applyModelExplanation,
  buildExportDocument,
  canExportAnswer,
  suggestedQuestions,
  type AskContext,
  type AskIntent,
  type ClarificationOption,
  type PulseAnswer,
} from "../../../lib/ask/index.ts";
import { AnswerCard } from "./AnswerCard.tsx";
import { downloadAnswersPdf } from "./exportPdf.ts";
import {
  ASK_MODEL_HOST,
  ASK_MODEL_LABEL,
  ASK_MODEL_LICENSE,
  ASK_MODEL_SIZE_NOTE,
  cancelAskModel,
  explainWithModel,
  isAskModelLoadCancelled,
  loadAskModel,
  type ModelStatus,
} from "./modelRuntime.ts";

async function downloadOne(answer: PulseAnswer) {
  const result = buildExportDocument(answer.hospitalName, [answer]);
  if (!result.ok) return;
  await downloadAnswersPdf(result.document, `pulseline-${answer.hospitalId}-answer.pdf`);
}

export function AskPane({
  context,
  answers,
  selectedIds,
  onAnswers,
  onSelectedIds,
  onClear,
}: {
  context: AskContext;
  answers: PulseAnswer[];
  selectedIds: string[];
  onAnswers: (answers: PulseAnswer[]) => void;
  onSelectedIds: (ids: string[]) => void;
  onClear: () => void;
}) {
  const chips = useMemo(() => suggestedQuestions(context), [context]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [modelStatus, setModelStatus] = useState<ModelStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [modelError, setModelError] = useState("");
  const [visibleIndex, setVisibleIndex] = useState(0);
  const swipeStart = useRef<number | null>(null);
  const index = answers.length === 0 ? 0 : Math.min(visibleIndex, answers.length - 1);
  const current = answers[index] ?? null;

  useEffect(() => {
    setVisibleIndex((currentIndex) => {
      if (answers.length === 0) return 0;
      return Math.min(currentIndex, answers.length - 1);
    });
  }, [answers.length]);

  const selectedAnswers = answers.filter((answer) => selectedIds.includes(answer.id) && canExportAnswer(answer));
  const exportState = buildExportDocument(context.hospitalName, selectedAnswers);
  const primaryChips = chips.filter((chip) => {
    if (chip.id === "explain_measure" || chip.id === "why_score" || chip.id === "missing") return true;
    return context.kind !== "scored" && (chip.id === "events" || chip.id === "community");
  });
  const moreChips = chips.filter((chip) => !primaryChips.some((primary) => primary.id === chip.id));

  function push(answer: PulseAnswer) {
    const next = [...answers, { ...answer, id: `${answer.id}:${answers.length}` }];
    onAnswers(next);
    setVisibleIndex(next.length - 1);
  }

  function move(next: number) {
    if (answers.length === 0) return;
    setVisibleIndex(Math.max(0, Math.min(next, answers.length - 1)));
  }

  function clearConversation() {
    setVisibleIndex(0);
    onClear();
  }

  async function maybeExplain(answer: PulseAnswer): Promise<PulseAnswer> {
    if (modelStatus !== "ready" || answer.status !== "complete") {
      return applyModelExplanation(answer, null);
    }
    try {
      return await explainWithModel(answer);
    } catch {
      return applyModelExplanation(answer, null);
    }
  }

  async function ask(question: string, intent?: AskIntent) {
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const base = intent ? answerKnownIntent(context, text, intent) : answerQuestion(context, text);
      push(await maybeExplain(base));
      setDraft("");
    } finally {
      setBusy(false);
    }
  }

  async function resolve(option: ClarificationOption, original: PulseAnswer) {
    const next = answerQuestion(context, original.question, {
      intent: option.intent,
      raw: original.question,
      year: option.year,
      yearKind: option.yearKind,
      metric: option.metric,
    });
    push(await maybeExplain(next));
  }

  async function startModel() {
    setModelStatus("downloading");
    setModelError("");
    setProgress(0);
    try {
      await loadAskModel((percent, text) => {
        setProgress(percent);
        setProgressText(text);
      });
      setModelStatus("ready");
    } catch (error) {
      if (isAskModelLoadCancelled(error)) {
        setModelStatus("idle");
        setModelError("");
        setProgressText("");
        return;
      }
      setModelStatus("failed");
      setModelError(error instanceof Error ? error.message : "The on-device helper could not start.");
    }
  }

  function stopModel() {
    cancelAskModel();
    setModelStatus("idle");
    setProgress(0);
    setProgressText("");
  }

  function toggle(id: string) {
    onSelectedIds(selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]);
  }

  const showMoreChips = moreChips.length > 0;

  return (
    <>
      <section className="ask-card" aria-labelledby="ask-title">
        <div className="ask-head">
          <h3 id="ask-title">Ask about this hospital</h3>
          {answers.length > 0 ? (
            <button type="button" className="text-link" onClick={clearConversation}>
              Clear conversation
            </button>
          ) : null}
        </div>
        <p className="muted small ask-suggested">
          Suggested: {primaryChips.map((chip) => chip.label).join(" · ") || "available questions for this hospital"}
        </p>

        <div className="chip-row">
          {primaryChips.map((chip) => (
            <button key={chip.id} type="button" className="chip" onClick={() => void ask(chip.question, chip.intent)}>
              {chip.label}
            </button>
          ))}
        </div>
        {showMoreChips ? (
          <div className="chip-row chip-row-more">
            {moreChips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                className="chip chip-quiet"
                onClick={() => void ask(chip.question, chip.intent)}
              >
                {chip.label}
              </button>
            ))}
          </div>
        ) : null}

        {current ? (
          <div className="answer-deck">
            <div className="card-nav">
              <button
                type="button"
                className="card-arrow"
                aria-label="Previous question"
                disabled={index === 0}
                onClick={() => move(index - 1)}
              >
                ←
              </button>
              <p className="card-position">
                {index + 1} of {answers.length}
              </p>
              <button
                type="button"
                className="card-arrow"
                aria-label="Next question"
                disabled={index >= answers.length - 1}
                onClick={() => move(index + 1)}
              >
                →
              </button>
            </div>
            <div
              className="answer-slide"
              tabIndex={0}
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
                swipeStart.current = event.changedTouches[0]?.clientX ?? null;
              }}
              onTouchEnd={(event) => {
                const start = swipeStart.current;
                const end = event.changedTouches[0]?.clientX;
                swipeStart.current = null;
                if (start == null || end == null) return;
                const delta = end - start;
                if (delta > 40) move(index - 1);
                if (delta < -40) move(index + 1);
              }}
            >
              <AnswerCard
                answer={current}
                selected={selectedIds.includes(current.id)}
                onToggle={toggle}
                onDownload={(item) => void downloadOne(item)}
              />
              {current.status === "clarification"
                ? current.clarificationOptions.map((option) => (
                    <button key={option.id} type="button" className="chip" onClick={() => void resolve(option, current)}>
                      {option.label}
                    </button>
                  ))
                : null}
              {current.suggestedFollowUps.map((follow) => (
                <button key={follow} type="button" className="chip chip-quiet" onClick={() => void ask(follow)}>
                  {follow}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <form
        className="ask-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(draft);
        }}
      >
        <label className="visually-hidden" htmlFor="ask-input">
          Ask a follow-up about {context.hospitalName}
        </label>
        <input
          id="ask-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask a follow-up about this hospital…"
          autoComplete="off"
        />
        <button type="submit" className="btn-primary" disabled={busy || draft.trim() === ""}>
          Ask
        </button>
      </form>

      <div className="ask-aux">
        <div className={`export-bar ${selectedAnswers.length > 0 ? "has-selection" : ""}`} role="region" aria-label="Selected answers">
          {selectedAnswers.length === 0 ? (
            <p className="tiny">No answers selected. Select a completed answer to download evidence notes.</p>
          ) : (
            <p className="small">{selectedAnswers.length} selected</p>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={!exportState.ok}
            onClick={() => {
              if (!exportState.ok) return;
              void downloadAnswersPdf(exportState.document, `pulseline-${context.hospitalId}-answers.pdf`);
            }}
          >
            Download selected answers
          </button>
        </div>

        <p className="tiny ask-footnote">
          Evidence notes include only selected questions and answers, periods, sources, limitations, and scenario
          assumptions when present. Not a completed diligence report or investment recommendation.
        </p>

        <aside className="model-gate" aria-live="polite">
          {modelStatus === "idle" || modelStatus === "prompt" ? (
            <>
              <p className="tiny">
                Browser AI is optional. Exact-data answers remain available without it. {ASK_MODEL_LABEL} downloads from{" "}
                {ASK_MODEL_HOST} to this device. {ASK_MODEL_SIZE_NOTE} {ASK_MODEL_LICENSE}.
              </p>
              <button type="button" className="chip" onClick={() => void startModel()}>
                Load on-device helper
              </button>
            </>
          ) : null}
          {modelStatus === "downloading" ? (
            <>
              <p className="small">
                Downloading to this device… {progress}% {progressText}
              </p>
              <button type="button" className="chip" onClick={stopModel}>
                Cancel download
              </button>
            </>
          ) : null}
          {modelStatus === "ready" ? (
            <p className="tiny">On-device helper ready. Numbers still come from PulseLine data.</p>
          ) : null}
          {modelStatus === "failed" || modelStatus === "unavailable" ? (
            <>
              <p className="small">{modelError || "The on-device helper is unavailable."} Continuing with data lookup.</p>
              <button type="button" className="chip" onClick={() => void startModel()}>
                Retry download
              </button>
            </>
          ) : null}
        </aside>
      </div>
    </>
  );
}
