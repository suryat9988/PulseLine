import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { adaptEvidencePack } from "../lib/adapt-evidence.ts";
import { answerKnownIntent, buildExportDocument, formatAnswerText, researchAskContext, scoredAskContext } from "../lib/ask/index.ts";
import { loadResearchDashboard } from "../lib/pipeline.ts";
import { signedComparisonLayout } from "../lib/scenario/bars.ts";
import {
  clampChangePct,
  evaluateScenario,
  resetScenarioInputs,
  scenarioFromPercents,
} from "../lib/scenario/whatif.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const researchPack = JSON.parse(readFileSync(join(root, "research", "PulseLine_three_hospital_data.json"), "utf8"));
const evidencePack = JSON.parse(readFileSync(join(root, "research", "PulseLine_expanded_evidence_v1.json"), "utf8"));
const loaded = loadResearchDashboard(researchPack);
const evidence = adaptEvidencePack(evidencePack);

function facility(name: string) {
  const found = loaded.facilities.find((item) => item.name.includes(name));
  assert.ok(found);
  return found;
}

describe("what-if scenario model", () => {
  it("applies the documented formulas and reset", () => {
    const math = scenarioFromPercents(100, 80, 10, -5);
    assert.equal(math.scenarioRevenue, 110);
    assert.equal(math.scenarioExpenses, 76);
    assert.equal(math.scenarioBalance, 34);
    assert.equal(math.baselineBalance, 20);
    assert.equal(math.balanceChange, 14);
    assert.equal(math.revenueToEqualExpenses, 76);
    assert.equal(math.requiredRevenueChangePct, -24);
    assert.deepEqual(resetScenarioInputs(), { revenueChangePct: 0, expenseChangePct: 0 });
    assert.equal(clampChangePct(999), 400);
    assert.equal(clampChangePct(-200), -95);
    assert.equal(clampChangePct(Number.NaN), 0);
  });

  it("uses a real baseline and does not mutate the historical score", () => {
    const item = facility("Breckinridge");
    const before = item.latest.financial.score;
    const baseline = evaluateScenario(item.latest, resetScenarioInputs());
    const shocked = evaluateScenario(item.latest, { revenueChangePct: 15, expenseChangePct: -10 });
    assert.equal(baseline.enabled, true);
    assert.equal(shocked.enabled, true);
    assert.equal(item.latest.financial.score, before);
    assert.equal(item.latest.hospital.financials.netPatientRevenue, baseline.baselineRevenue);
    assert.notEqual(shocked.scenarioRevenue, shocked.baselineRevenue);
  });

  it("disables missing baselines and research cases", () => {
    const item = facility("Morgan");
    const missing = {
      ...item.latest,
      hospital: {
        ...item.latest.hospital,
        financials: { ...item.latest.hospital.financials, netPatientRevenue: null },
      },
    };
    const disabled = evaluateScenario(missing, resetScenarioInputs());
    assert.equal(disabled.enabled, false);
    assert.match(disabled.disabledReason ?? "", /missing/i);
    const research = evidence.ledger?.hospitals.find((hospital) => hospital.hospitalId === "case_highlands");
    assert.ok(research);
    const pending = evaluateScenario(null, resetScenarioInputs(), { pending: true, hospitalName: research.name });
    assert.equal(pending.enabled, false);
    assert.match(pending.disabledReason ?? "", /pending/i);
  });

  it("refuses a silent mismatch between published patient-service result and subtraction", () => {
    const item = facility("Breckinridge");
    const mismatched = {
      ...item.latest,
      hospital: {
        ...item.latest.hospital,
        sourceFields: {
          ...item.latest.hospital.sourceFields,
          "Net Income from Service to Patients": "1",
        },
      },
    };
    const result = evaluateScenario(mismatched, resetScenarioInputs());
    assert.equal(result.enabled, false);
    assert.match(result.disabledReason ?? "", /does not equal/i);
  });

  it("exports scenario assumptions with the answer and keeps Ask isolated", () => {
    const item = facility("Morgan");
    const scenario = evaluateScenario(item.latest, { revenueChangePct: 5, expenseChangePct: 2 });
    const names = [...loaded.facilities.map((row) => row.name), "Highlands Regional Medical Center"];
    const context = scoredAskContext(item, item.latest.hospital.id, evidence.ledger, names, scenario);
    const answer = answerKnownIntent(context, "What happens if revenue or expenses change?", "whatif_scenario");
    assert.equal(answer.kind, "scenario");
    assert.equal(answer.status, "complete");
    assert.ok(answer.scenario);
    assert.equal(answer.scenario.revenueChangePct, 5);
    assert.match(answer.statement, /scenario/);
    const text = formatAnswerText(answer);
    assert.match(text, /Scenario assumptions/);
    assert.match(text, /Illustrative scenario/);
    const exported = buildExportDocument(context.hospitalName, [answer]);
    assert.equal(exported.ok, true);
    if (exported.ok) {
      assert.equal(exported.document.answers[0]?.scenario?.expenseChangePct, 2);
      assert.ok(exported.document.answers[0]?.scenario?.formulas.length);
    }
    const switched = answerKnownIntent(context, "What about Highlands Regional Medical Center revenue?", "hospital_switch");
    assert.equal(switched.status, "declined");
    const research = evidence.ledger?.hospitals.find((hospital) => hospital.name.includes("Highlands"));
    assert.ok(research);
    const researchAnswer = answerKnownIntent(
      researchAskContext(research, evidence.ledger, names),
      "What happens if revenue or expenses change?",
      "whatif_scenario",
    );
    assert.equal(researchAnswer.status, "unavailable");
  });

  it("places equal losses and surpluses on opposite sides of a zero-centered chart", () => {
    const layout = signedComparisonLayout([
      { id: "baseline", label: "Baseline balance", value: -10 },
      { id: "scenario", label: "Scenario balance", value: 10 },
    ]);
    assert.equal(layout.zeroPct, 50);
    assert.equal(layout.rows[0]?.sign, "negative");
    assert.equal(layout.rows[1]?.sign, "positive");
    assert.equal(layout.rows[0]?.widthPct, layout.rows[1]?.widthPct);
    assert.ok((layout.rows[0]?.leftPct ?? 0) < layout.zeroPct);
    assert.equal(layout.rows[1]?.leftPct, layout.zeroPct);
    const zeros = signedComparisonLayout([
      { id: "baseline", label: "Baseline balance", value: 0 },
      { id: "scenario", label: "Scenario balance", value: 0 },
    ]);
    assert.equal(zeros.rows[0]?.sign, "zero");
    assert.equal(zeros.rows[0]?.widthPct, 0);
    const missing = signedComparisonLayout([
      { id: "baseline", label: "Baseline balance", value: null },
      { id: "scenario", label: "Scenario balance", value: 25 },
    ]);
    assert.equal(missing.rows[0]?.sign, "missing");
    assert.equal(missing.rows[0]?.available, false);
    assert.equal(missing.rows[0]?.value, null);
    assert.notEqual(missing.rows[0]?.value, 0);
    assert.equal(missing.rows[1]?.sign, "positive");
  });
});
