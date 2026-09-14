import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { FINANCIAL_VIEW_OPTIONS, seriesForView, viewHasValues } from "../lib/charts/views.ts";
import {
  financialChartSeries,
  reportsComparable,
  safePercentChange,
} from "../lib/charts/series.ts";
import { loadResearchDashboard } from "../lib/pipeline.ts";
import type { HospitalView } from "../src/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const researchPack = JSON.parse(readFileSync(join(root, "research", "PulseLine_three_hospital_data.json"), "utf8"));
const loaded = loadResearchDashboard(researchPack);

function facility(name: string) {
  const found = loaded.facilities.find((item) => item.name.includes(name));
  assert.ok(found);
  return found;
}

describe("financial chart series", () => {
  it("preserves missing and negative values without coercing them to zero", () => {
    const river = facility("Kentucky River");
    const cash = financialChartSeries(river.reports).find((series) => series.id === "cash");
    assert.ok(cash);
    assert.ok(cash.points.some((point) => point.value !== null && point.value < 0));
    assert.ok(!cash.points.some((point) => point.value === 0 && point.exclusion?.includes("Missing")));
    const empty: HospitalView = {
      ...river.latest,
      hospital: {
        ...river.latest.hospital,
        financials: { ...river.latest.hospital.financials, cash: null, netPatientRevenue: null },
      },
    };
    const missing = financialChartSeries([empty]).find((series) => series.id === "cash");
    assert.equal(missing?.points[0]?.value, null);
    assert.notEqual(missing?.points[0]?.value, 0);
    assert.match(missing?.points[0]?.exclusion ?? "", /Missing/);
  });

  it("uses fiscal dates and flags incomparable period lengths", () => {
    const breck = facility("Breckinridge");
    const series = financialChartSeries(breck.reports).find((item) => item.id === "npr_expenses");
    assert.ok(series);
    assert.ok(series.points.every((point) => /^\d{4}-\d{2}-\d{2}$/.test(point.end)));
    assert.ok(!series.points.some((point) => String(point.fileCohort) === point.end));
    const stretched = breck.reports.map((report, index) => ({
      ...report,
      hospital: { ...report.hospital, periodDays: index === 0 ? 180 : 400 },
    }));
    const comparability = reportsComparable(stretched);
    assert.equal(comparability.comparable, false);
    assert.equal(comparability.state, "incompatible");
    assert.match(comparability.note, /not comparable/i);
    assert.match(comparability.note, /30 days/);
    const missingDays = breck.reports.map((report) => ({
      ...report,
      hospital: { ...report.hospital, periodDays: null },
    }));
    const limited = reportsComparable(missingDays);
    assert.equal(limited.state, "limited");
    assert.match(limited.note, /Limited comparison/i);
    assert.match(limited.note, /cannot verify/i);
    const current = reportsComparable(breck.reports);
    assert.equal(current.state, "comparable");
  });

  it("keeps supported financial views on sourced series and does not interpolate gaps", () => {
    const morgan = facility("Morgan");
    assert.equal(FINANCIAL_VIEW_OPTIONS.length, 5);
    const revenue = seriesForView("npr_expenses", morgan.reports);
    assert.equal(revenue.primary.points.length, morgan.reports.length);
    assert.ok(revenue.secondary);
    assert.ok(viewHasValues("npr_expenses", morgan.reports));
    assert.ok(revenue.primary.points.every((point) => point.value === null || Number.isFinite(point.value)));
    const result = seriesForView("patient_service_result", morgan.reports);
    assert.equal(result.primary.unit, "usd");
    const cash = seriesForView("cash_liquidity", morgan.reports);
    assert.equal(cash.primary.unit, "usd");
    assert.equal(cash.secondary?.unit, "ratio");
  });

  it("does not invent a percent change from missing or zero baselines", () => {
    assert.equal(safePercentChange(10, null), null);
    assert.equal(safePercentChange(null, 10), null);
    assert.equal(safePercentChange(10, 0), null);
    assert.equal(safePercentChange(12, 10), 20);
  });
});
