import type { ExportDocument } from "../../../lib/ask/index.ts";

export async function downloadAnswersPdf(doc: ExportDocument, filename: string): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 56;
  const width = 612 - margin * 2;
  let y = margin;

  const write = (text: string, size: number, bold = false) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(size);
    const lines = pdf.splitTextToSize(text, width) as string[];
    for (const line of lines) {
      if (y > 720) {
        pdf.addPage();
        y = margin;
      }
      pdf.text(line, margin, y);
      y += size + 6;
    }
  };

  write("PulseLine evidence notes", 16, true);
  write(doc.hospitalName, 13, true);
  write(`Exported ${doc.exportedAt}`, 10);
  y += 8;
  write(doc.experimentalNote, 9);
  y += 10;

  for (const [index, answer] of doc.answers.entries()) {
    if (y > 640) {
      pdf.addPage();
      y = margin;
    }
    write(`Question ${index + 1}`, 11, true);
    write(answer.question, 11);
    write(`Hospital: ${answer.hospitalName}`, 10);
    write("Answer", 11, true);
    write(answer.statement, 11);
    if (answer.periodRows.length > 0) {
      for (const row of answer.periodRows) write(`${row.label}: ${row.value}`, 10);
    } else if (answer.periodLabel) {
      write(`Period: ${answer.periodLabel}`, 10);
    }
    write(answer.modeLabel, 9);
    if (answer.explanation) write(answer.explanation, 9);
    write(`Kind: ${answer.kind.replaceAll("_", " ")}`, 10);
    if (answer.scenario) {
      write("Scenario assumptions", 11, true);
      write(`Baseline period: ${answer.scenario.baselinePeriod ?? "Unknown"}`, 10);
      write(`Assumed net patient revenue change: ${answer.scenario.revenueChangePct}%`, 10);
      write(`Assumed patient-service expense change: ${answer.scenario.expenseChangePct}%`, 10);
      for (const formula of answer.scenario.formulas) write(formula, 9);
      write(answer.scenario.limitation, 9);
    }
    if (answer.sources.length) {
      write("Sources", 11, true);
      for (const source of answer.sources) {
        const report = source.reportId ? ` · report ${source.reportId}` : "";
        const label = `${source.label}${report}`;
        if (source.url) {
          if (y > 720) {
            pdf.addPage();
            y = margin;
          }
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(10);
          pdf.setTextColor(42, 122, 120);
          pdf.textWithLink(label, margin, y, { url: source.url });
          pdf.setTextColor(22, 52, 58);
          y += 16;
        } else {
          write(label, 10);
        }
      }
    }
    if (answer.limitations.length) {
      write("Limitations", 11, true);
      for (const line of answer.limitations) write(line, 9);
    }
    y += 16;
  }

  pdf.save(filename);
}
