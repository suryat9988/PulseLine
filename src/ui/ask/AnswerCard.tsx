import { answerModeLabel, answerPeriodRows, canExportAnswer, formatAnswerText, type PulseAnswer } from "../../../lib/ask/index.ts";

function cardQuestion(question: string): string {
  if (
    question === "What was its net patient revenue for the selected fiscal period?" ||
    question === "What was net patient revenue for this fiscal period?"
  ) {
    return "What was net patient revenue?";
  }
  return question;
}

export function AnswerCard({
  answer,
  selected,
  onToggle,
  onDownload,
}: {
  answer: PulseAnswer;
  selected: boolean;
  onToggle: (id: string) => void;
  onDownload: (answer: PulseAnswer) => void;
}) {
  const complete = canExportAnswer(answer);
  const periodRows = answerPeriodRows(answer);
  const kindNote =
    answer.kind === "reported"
      ? "Reported CMS value, rounded. Not a current estimate."
      : answer.kind === "calculated"
        ? "Calculated from PulseLine reports. Not a forecast."
        : answer.kind === "scenario"
          ? "Illustrative scenario—not a forecast. Not reported data."
          : "Experimental interpretation of available PulseLine evidence.";

  async function copy() {
    await navigator.clipboard.writeText(formatAnswerText(answer));
  }

  return (
    <article className={`answer-card ${complete ? "" : "is-incomplete"}`}>
      <p className="answer-question">{cardQuestion(answer.question)}</p>
      <p className="answer-hospital">{answer.hospitalName}</p>
      {answer.headline ? <p className="answer-headline">{answer.headline}</p> : <p className="answer-statement">{answer.statement}</p>}
      {answer.headline ? <p className="visually-hidden">{answer.statement}</p> : null}
      {periodRows.length > 0 ? (
        <div className="answer-periods">
          {periodRows.map((row) => (
            <p className="answer-meta" key={`${row.label}:${row.value}`}>
              <span className="period-prefix">{row.label}: </span>
              {row.value}
            </p>
          ))}
        </div>
      ) : null}
      <p className="answer-meta">{kindNote}</p>
      <p className="answer-meta">{answerModeLabel(answer.mode)}</p>
      {answer.mode === "on_device_explanation" && answer.explanation ? (
        <p className="muted small">{answer.explanation}</p>
      ) : null}
      {answer.sources.length > 0 ? (
        <div className="source-box">
          {answer.sources.map((source) => (
            <p key={`${source.label}-${source.reportId ?? source.url ?? ""}`}>
              <span className="source-prefix">Source: </span>
              {source.reportId ? `CMS report ${source.reportId}` : source.label}
              {source.url ? (
                <>
                  {" · "}
                  <a href={source.url} target="_blank" rel="noreferrer">
                    View report
                  </a>
                </>
              ) : null}
            </p>
          ))}
        </div>
      ) : null}
      {answer.limitations.slice(0, 1).map((line) => (
        <p className="tiny" key={line}>
          {line}
        </p>
      ))}
      <label className={`select-row ${complete ? "" : "is-disabled"}`}>
        <input type="checkbox" checked={selected} disabled={!complete} onChange={() => onToggle(answer.id)} />
        <span className="select-label-wide">Include this answer in my download</span>
        <span className="select-label-narrow">Select this answer</span>
      </label>
      <div className="answer-actions">
        <button type="button" className="btn-primary" disabled={!complete} onClick={() => onDownload(answer)}>
          Download this answer
        </button>
        <button type="button" className="btn-secondary" disabled={!complete} onClick={() => void copy()}>
          Copy answer
        </button>
      </div>
    </article>
  );
}
