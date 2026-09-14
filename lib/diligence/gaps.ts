import type { EvidenceHospital, EvidenceObservation, HospitalView, StructuralEvent } from "../../src/types.ts";

export const GAP_KINDS = [
  "missing_from_pulseline",
  "excluded_uninterpretable",
  "unavailable_in_source",
  "conflicting_evidence",
  "not_yet_investigated",
] as const;
export type GapKind = (typeof GAP_KINDS)[number];

export const GAP_KIND_LABELS: Record<GapKind, string> = {
  missing_from_pulseline: "Missing from PulseLine",
  excluded_uninterpretable: "Excluded because the value is not interpretable",
  unavailable_in_source: "Explicitly unavailable in the source",
  conflicting_evidence: "Conflicting evidence",
  not_yet_investigated: "Not yet investigated",
};

export interface DiligenceGap {
  id: string;
  kind: GapKind;
  label: string;
  detail: string;
}

export const EMPTY_EVENT_LEDGER =
  "No sourced structural events are attached in the current PulseLine ledger. That is not a finding that no events exist.";

function pushUnique(gaps: DiligenceGap[], next: DiligenceGap): void {
  if (gaps.some((item) => item.id === next.id)) return;
  gaps.push(next);
}

export function diligenceGaps(input: {
  view: HospitalView | null;
  research: EvidenceHospital | null;
  events: StructuralEvent[];
  observations: EvidenceObservation[];
  pending: boolean;
}): DiligenceGap[] {
  const gaps: DiligenceGap[] = [];
  const { view, research, events, observations, pending } = input;

  if (pending || !view) {
    pushUnique(gaps, {
      id: "financials_pending",
      kind: "missing_from_pulseline",
      label: "Obtain historical CMS financial statements",
      detail: `Financial data pending for ${research?.name ?? "this hospital"}. PulseLine did not invent a CCN, score, or scenario baseline.`,
    });
    if (research?.ccnAtEvent == null) {
      pushUnique(gaps, {
        id: "event_ccn",
        kind: "missing_from_pulseline",
        label: "Verify event-time CCN and legal entity",
        detail: "No event-time CCN is recorded for this research case.",
      });
    }
    if (research?.providerChow === "unknown") {
      pushUnique(gaps, {
        id: "provider_chow",
        kind: "not_yet_investigated",
        label: "Confirm provider change of ownership",
        detail: "Provider CHOW is recorded as unknown. An acquisition announcement is not a verified facility CHOW.",
      });
    }
  } else {
    const hospital = view.hospital;
    if (hospital.dataQuality.addressMismatch) {
      pushUnique(gaps, {
        id: "address_mismatch",
        kind: "conflicting_evidence",
        label: "Reconcile historical and current addresses",
        detail: "A street-address discrepancy is recorded. A current location does not resolve historical address or CCN questions.",
      });
    }
    if (hospital.historicalCcn && hospital.currentCcn && hospital.historicalCcn !== hospital.currentCcn) {
      pushUnique(gaps, {
        id: "ccn_transition",
        kind: "conflicting_evidence",
        label: "Verify historical and current CCN relationship",
        detail: `Reported CCN ${hospital.historicalCcn} differs from current CCN ${hospital.currentCcn}. Transition timing is unresolved.`,
      });
    }
    const unsupported = view.financial.factors.filter((factor) => factor.availability === "unsupported");
    for (const factor of unsupported) {
      pushUnique(gaps, {
        id: `unsupported:${factor.id}`,
        kind: "excluded_uninterpretable",
        label: `${factor.metric} is not a supported calculation`,
        detail: factor.exclusion ?? "The source fields do not support this calculation.",
      });
    }
    const invalid = view.financial.factors.filter((factor) => factor.availability === "invalid");
    for (const factor of invalid) {
      pushUnique(gaps, {
        id: `invalid:${factor.id}`,
        kind: "excluded_uninterpretable",
        label: `${factor.metric} was excluded`,
        detail: factor.exclusion ?? "The published value is not interpretable for this ratio.",
      });
    }
    const unavailable = view.financial.factors.filter((factor) => factor.availability === "unavailable");
    for (const factor of unavailable) {
      pushUnique(gaps, {
        id: `unavailable:${factor.id}`,
        kind: "missing_from_pulseline",
        label: `Obtain ${factor.metric}`,
        detail: factor.exclusion ?? "This measure is not in the current PulseLine extract.",
      });
    }
    pushUnique(gaps, {
      id: "entity_scope",
      kind: "not_yet_investigated",
      label: "Confirm reporting-entity versus parent consolidation scope",
      detail: "PulseLine has not independently reconciled whether the CMS report is facility-only or consolidated.",
    });
    pushUnique(gaps, {
      id: "newer_financials",
      kind: "missing_from_pulseline",
      label: "Obtain more recent financial statements",
      detail: "The latest available fiscal report in PulseLine is historical. It is not live operating performance.",
    });
  }

  if (events.length === 0) {
    pushUnique(gaps, {
      id: "event_ledger_empty",
      kind: "missing_from_pulseline",
      label: "Review whether structural events exist outside PulseLine",
      detail: EMPTY_EVENT_LEDGER,
    });
  }

  for (const event of events) {
    if (event.ccnAtEvent == null) {
      pushUnique(gaps, {
        id: `event_ccn:${event.eventId}`,
        kind: "missing_from_pulseline",
        label: "Verify event-time CCN and legal entity",
        detail: `${event.eventSubtype.replaceAll("_", " ")} has no event-time CCN in the ledger.`,
      });
    }
    if (event.buyer == null && event.seller == null && event.eventCategory === "acquisition") {
      pushUnique(gaps, {
        id: `parties:${event.eventId}`,
        kind: "missing_from_pulseline",
        label: "Name the parties and their roles",
        detail: "Buyer and seller are not both recorded for this acquisition group.",
      });
    }
    for (const source of event.sources) {
      if (source.publicationDate == null) {
        pushUnique(gaps, {
          id: `pubdate:${source.sourceId}`,
          kind: "unavailable_in_source",
          label: "Verify source publication date",
          detail: `${source.title} has a null publication date. That cannot establish pre-event availability.`,
        });
      }
    }
  }

  if (!observations.some((item) => item.domain === "operational" && item.metric.toLowerCase().includes("service"))) {
    pushUnique(gaps, {
      id: "service_availability",
      kind: "not_yet_investigated",
      label: "Confirm current service availability",
      detail: "PulseLine does not verify real-time emergency or inpatient service status.",
    });
  }

  pushUnique(gaps, {
    id: "workforce_nppes",
    kind: "not_yet_investigated",
    label: "Workforce and clinician histories remain pending",
    detail: "County access measures are not hospital employee counts. Absence of a workforce snapshot is not stability.",
  });

  return gaps;
}

const BRIEF_PRIORITY_IDS = new Set([
  "entity_scope",
  "ccn_transition",
  "address_mismatch",
  "financials_pending",
  "event_ccn",
  "newer_financials",
]);

export function briefEvidenceGaps(input: {
  view: HospitalView | null;
  research: EvidenceHospital | null;
  events: StructuralEvent[];
  observations: EvidenceObservation[];
  pending: boolean;
  comparable?: boolean;
  durationOk?: boolean;
  durationStatus?: "pass" | "unknown" | "fail";
  overlapOrDuplicate?: boolean;
  publicationUnverified?: boolean;
  displayedMissing?: string[];
}): { priority: DiligenceGap[]; additional: DiligenceGap[] } {
  const gaps = diligenceGaps(input);
  if (!input.pending) {
    if (input.durationStatus === "unknown") {
      pushUnique(gaps, {
        id: "missing_period_length",
        kind: "missing_from_pulseline",
        label: "Reporting-period length is missing",
        detail: "At least one report has no verified period length. PulseLine does not describe those lengths as being within 30 days.",
      });
    } else if (input.durationStatus === "fail") {
      pushUnique(gaps, {
        id: "unequal_periods",
        kind: "excluded_uninterpretable",
        label: "Reporting periods are not the same length",
        detail: "Period lengths differ by more than 30 days. Both reports are shown. PulseLine does not treat them as a continuous trend.",
      });
    }
  }
  if (input.overlapOrDuplicate) {
    pushUnique(gaps, {
      id: "overlap_or_duplicate",
      kind: "conflicting_evidence",
      label: "Overlapping or revised reports",
      detail: "These fiscal periods overlap or share a CMS report record id. PulseLine does not present an unqualified growth rate.",
    });
  }
  if (input.publicationUnverified && input.view) {
    pushUnique(gaps, {
      id: "unverified_publication",
      kind: "unavailable_in_source",
      label: "Source publication date is unverified",
      detail: "Unknown publication dates limit point-in-time historical claims. They do not prevent clearly labeled retrospective viewing of these reports. Fiscal-end age is not a publication or access date.",
    });
  }
  for (const label of input.displayedMissing ?? []) {
    pushUnique(gaps, {
      id: `displayed_missing:${label}`,
      kind: "missing_from_pulseline",
      label: `${label} is missing or invalid on a compared report`,
      detail: "A displayed finding uses a measure that is missing or excluded. Missing is not zero.",
    });
  }

  const priority: DiligenceGap[] = [];
  const additional: DiligenceGap[] = [];
  for (const gap of gaps) {
    const findingRelated =
      BRIEF_PRIORITY_IDS.has(gap.id) ||
      gap.id.startsWith("unsupported:") ||
      gap.id.startsWith("invalid:") ||
      gap.id.startsWith("unavailable:") ||
      gap.id.startsWith("displayed_missing:") ||
      gap.id === "unequal_periods" ||
      gap.id === "overlap_or_duplicate" ||
      gap.id === "unverified_publication";
    if (findingRelated) priority.push(gap);
    else additional.push(gap);
  }
  return { priority, additional };
}

export function screeningEvidenceGap(input: {
  pending: boolean;
  addressMismatch: boolean;
  identityUnresolved: boolean;
  locationPending: boolean;
  ccnMismatch: boolean;
}): string {
  if (input.pending) return "Financial data pending";
  if (input.addressMismatch) return "Address discrepancy";
  if (input.ccnMismatch) return "Historical and current CCN differ";
  if (input.identityUnresolved) return "Identity review required";
  if (input.locationPending) return "Location pending";
  return "No identity gap flagged in PulseLine";
}
