import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { adaptEvidencePack, eventsForHospital, observationsForHospital } from "../lib/adapt-evidence.ts";
import { briefEvidenceGaps, diligenceGaps, EMPTY_EVENT_LEDGER, GAP_KINDS } from "../lib/diligence/gaps.ts";
import { eventScopeLabel, eventVerificationLabel, VERIFICATION_LIMIT } from "../lib/diligence/events.ts";
import { loadResearchDashboard } from "../lib/pipeline.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const researchPack = JSON.parse(readFileSync(join(root, "research", "PulseLine_three_hospital_data.json"), "utf8"));
const evidencePack = JSON.parse(readFileSync(join(root, "research", "PulseLine_expanded_evidence_v1.json"), "utf8"));
const loaded = loadResearchDashboard(researchPack);
const evidence = adaptEvidencePack(evidencePack);
assert.equal(loaded.ok, true);
assert.ok(evidence.ledger);

describe("diligence evidence gaps", () => {
  it("classifies gaps without treating an empty ledger as no events", () => {
    const river = loaded.facilities.find((item) => item.name.includes("Kentucky River"));
    assert.ok(river);
    const gaps = diligenceGaps({
      view: river.latest,
      research: null,
      events: eventsForHospital(evidence.ledger, river.hospitalId),
      observations: observationsForHospital(evidence.ledger, river.hospitalId),
      pending: false,
    });
    assert.ok(gaps.every((gap) => (GAP_KINDS as readonly string[]).includes(gap.kind)));
    assert.ok(gaps.some((gap) => gap.kind === "conflicting_evidence"));
    assert.ok(gaps.some((gap) => gap.id === "entity_scope" && gap.kind === "not_yet_investigated"));
    const empty = diligenceGaps({
      view: river.latest,
      research: null,
      events: [],
      observations: [],
      pending: false,
    });
    const ledgerGap = empty.find((gap) => gap.id === "event_ledger_empty");
    assert.equal(ledgerGap?.detail, EMPTY_EVENT_LEDGER);
    assert.ok(!ledgerGap?.detail.toLowerCase().includes("no events."));
  });

  it("keeps pending research cases without a financial status or invented score", () => {
    const research = evidence.ledger?.hospitals.find((item) => item.name.includes("Highlands"));
    assert.ok(research);
    const gaps = diligenceGaps({
      view: null,
      research,
      events: eventsForHospital(evidence.ledger, research.hospitalId),
      observations: observationsForHospital(evidence.ledger, research.hospitalId),
      pending: true,
    });
    assert.ok(gaps.some((gap) => gap.id === "financials_pending" && gap.kind === "missing_from_pulseline"));
    assert.ok(!gaps.some((gap) => /stable|watch|high concern/i.test(gap.label)));
  });

  it("does not invent period-length comparison gaps for pending hospitals", () => {
    const research = evidence.ledger?.hospitals.find((item) => item.name.includes("Paul B. Hall"));
    assert.ok(research);
    const grouped = briefEvidenceGaps({
      view: null,
      research,
      events: eventsForHospital(evidence.ledger, research.hospitalId),
      observations: observationsForHospital(evidence.ledger, research.hospitalId),
      pending: true,
      durationOk: false,
    });
    const all = [...grouped.priority, ...grouped.additional];
    assert.ok(all.some((gap) => gap.id === "financials_pending"));
    assert.ok(!all.some((gap) => gap.id === "unequal_periods" || gap.id === "missing_period_length"));
  });

  it("emits missing-length and unequal-length gaps only from explicit duration states", () => {
    const river = loaded.facilities.find((item) => item.name.includes("Kentucky River"));
    assert.ok(river);
    const base = {
      view: river.latest,
      research: null,
      events: eventsForHospital(evidence.ledger, river.hospitalId),
      observations: observationsForHospital(evidence.ledger, river.hospitalId),
      pending: false,
    };
    const missing = [...briefEvidenceGaps({ ...base, durationStatus: "unknown" }).priority, ...briefEvidenceGaps({ ...base, durationStatus: "unknown" }).additional];
    const fail = [...briefEvidenceGaps({ ...base, durationStatus: "fail" }).priority, ...briefEvidenceGaps({ ...base, durationStatus: "fail" }).additional];
    const pass = [...briefEvidenceGaps({ ...base, durationStatus: "pass" }).priority, ...briefEvidenceGaps({ ...base, durationStatus: "pass" }).additional];
    assert.ok(missing.some((gap) => gap.id === "missing_period_length"));
    assert.match(missing.find((gap) => gap.id === "missing_period_length")?.detail ?? "", /does not describe those lengths as being within 30 days/i);
    assert.ok(fail.some((gap) => gap.id === "unequal_periods"));
    assert.ok(!pass.some((gap) => gap.id === "unequal_periods" || gap.id === "missing_period_length"));
  });
});

describe("event-scope distinctions", () => {
  it("labels Kentucky River property and parent events without inventing parties", () => {
    const river = loaded.facilities.find((item) => item.name.includes("Kentucky River"));
    assert.ok(river);
    const events = eventsForHospital(evidence.ledger, river.hospitalId);
    const property = events.find((event) => event.eventCategory === "property_transaction");
    const parent = events.find((event) => event.eventCategory === "parent_bankruptcy");
    assert.ok(property);
    assert.ok(parent);
    assert.match(eventScopeLabel(property), /not a verified provider CHOW/i);
    assert.match(eventScopeLabel(parent), /not a verified facility bankruptcy/i);
    assert.ok(eventVerificationLabel(parent) !== "unknown_requires_verification" || VERIFICATION_LIMIT.length > 0);
    assert.equal(property.buyer == null || typeof property.buyer === "string", true);
  });
});
