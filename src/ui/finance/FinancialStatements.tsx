import type { HospitalView } from "../../types.ts";
import { financialStatement, STATEMENT_GROUPS } from "../../../lib/finance/index.ts";
import { money, percent, ratio, shortFiscalRange } from "../format.ts";

function formatCell(
  unit: "usd" | "ratio" | "percent" | "days" | "count",
  value: number | null,
  excluded: boolean,
): string {
  if (excluded) return "Excluded";
  if (value === null) return "Missing";
  if (unit === "usd") return money(value);
  if (unit === "percent") return percent(value);
  if (unit === "ratio") return ratio(value);
  return value.toLocaleString("en-US");
}

export function FinancialStatements({ reports }: { reports: HospitalView[] }) {
  const statement = financialStatement(reports);
  return (
    <section className="statement-block" aria-labelledby="statement-title">
      <h3 id="statement-title">Financial statements</h3>
      <p className="tiny">
        Incomplete CMS extract. These rows are sourced or calculated PulseLine measures, not a complete audited statement.
      </p>
      <div className="statement-scroll">
        <table className="statement-table">
          <thead>
            <tr>
              <th scope="col">Measure</th>
              {statement.columns.map((column) => (
                <th scope="col" key={column.reportId}>
                  {shortFiscalRange(column.start, column.end)}
                </th>
              ))}
            </tr>
          </thead>
          {STATEMENT_GROUPS.map((group) => (
            <tbody key={group.id}>
              <tr className="statement-group">
                <th scope="colgroup" colSpan={statement.columns.length + 1}>
                  {group.label}
                </th>
              </tr>
              {statement.rows
                .filter((row) => row.group === group.id)
                .map((row) => (
                  <tr key={row.id}>
                    <th scope="row">
                      <div className="statement-measure">
                        <span className="statement-measure-name">{row.label}</span>
                        <span className="tiny statement-measure-origin">
                          {row.origin === "calculated" ? "Calculated in PulseLine" : "Source-reported"}
                          {row.cmsField ? ` · CMS field: ${row.cmsField}` : ""}
                        </span>
                        <details className="statement-definition">
                          <summary>What this is</summary>
                          <p>{row.definition}</p>
                          <p className="tiny">{row.not}</p>
                        </details>
                      </div>
                    </th>
                    {row.cells.map((cell) => (
                      <td key={cell.reportId} title={cell.exclusion ?? undefined}>
                        {formatCell(row.unit, cell.value, cell.excluded)}
                        {cell.exclusion ? <span className="visually-hidden"> {cell.exclusion}</span> : null}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          ))}
        </table>
      </div>
      {statement.reconcileNotes.some((note) => !note.reconciled) ? (
        <ul className="tiny">
          {statement.reconcileNotes
            .filter((note) => !note.reconciled)
            .map((note) => (
              <li key={note.reportId}>{note.note}</li>
            ))}
        </ul>
      ) : (
        <p className="tiny">Where both exist, published patient-service result and the derived subtraction are shown separately.</p>
      )}
    </section>
  );
}
