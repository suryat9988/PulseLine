import type { AddressEvidence, HospitalFinancials, ValidationIssue } from "../src/types.ts";
import type { HospitalExtractFile, HospitalExtractRecord } from "./normalize-hospital.ts";

export interface ResearchHospital {
  hospital_id: string;
  official_name: string;
  state: string;
  county: string;
  county_fips?: string;
  current_ccn: string;
  historical_cost_report_ccn: string;
  address: string;
  historical_link_status: string;
  outcome_missingness: string;
  ownership_category?: string | null;
  rural_classification?: string | null;
}

export interface ResearchReport {
  hospital_id: string;
  source_id: string;
  file_cohort: number;
  fiscal_start: string;
  fiscal_end: string;
  period_days: number;
  report_record_id: string;
  ccn_as_reported: string;
  scope: string;
  original_cms_fields: Record<string, unknown>;
}

export interface ResearchSource {
  url: string;
  accessed?: string;
  publication_date?: string | null;
  limitations?: string;
  sha256?: string;
}

export interface ResearchPack {
  hospitals: ResearchHospital[];
  hospital_year_reports: ResearchReport[];
  sources: Record<string, ResearchSource>;
}

export interface ResearchAdaptResult {
  ok: boolean;
  errors: ValidationIssue[];
  extract?: HospitalExtractFile;
}

const CMS_NUMERIC: Record<keyof HospitalFinancials | "serviceToPatientsIncome", string> = {
  netPatientRevenue: "Net Patient Revenue",
  operatingRevenue: "",
  operatingExpenses: "Less Total Operating Expense",
  operatingIncome: "",
  operatingMargin: "",
  totalAssets: "Total Assets",
  totalLiabilities: "Total Liabilities",
  currentAssets: "Total Current Assets",
  currentLiabilities: "Total Current Liabilities",
  cash: "Cash on Hand and in Banks",
  inpatientDays: "Total Days (V + XVIII + XIX + Unknown)",
  discharges: "Total Discharges (V + XVIII + XIX + Unknown)",
  availableBeds: "Number of Beds",
  bedDaysAvailable: "Total Bed Days Available",
  uncompensatedCare: "Cost of Uncompensated Care",
  serviceToPatientsIncome: "Net Income from Service to Patients",
};

function issue(code: string, path: string, message: string): ValidationIssue {
  return { code, path, message };
}

/** Parse a CMS original string. Null stays null. Malformed strings are rejected, not treated as missing. */
export function parseCmsNumeric(value: unknown, path: string): { value: number | null; error?: ValidationIssue } {
  if (value === null || value === undefined) return { value: null };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return { value: null, error: issue("INVALID_TYPE", path, "Numeric field is not finite.") };
    }
    return { value };
  }
  if (typeof value !== "string") {
    return {
      value: null,
      error: issue("INVALID_TYPE", path, `Expected a CMS numeric string or null. Received ${typeof value}.`),
    };
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return { value: null, error: issue("INVALID_TYPE", path, "Empty CMS numeric string was not coerced to missing.") };
  }
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) {
    return { value: null, error: issue("INVALID_TYPE", path, `Malformed CMS numeric string "${value}" was not treated as missing.`) };
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return { value: null, error: issue("INVALID_TYPE", path, `CMS numeric string "${value}" is not a finite number.`) };
  }
  return { value: parsed };
}

function cityFromAddress(address: string, fallback: string): string {
  const parts = address.split(",").map((part) => part.trim());
  return parts[1] ?? fallback;
}

function zipFromCms(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  return value.replace(/-$/, "").trim();
}

export function adaptResearchPack(input: unknown): ResearchAdaptResult {
  const errors: ValidationIssue[] = [];
  if (!input || typeof input !== "object") {
    return { ok: false, errors: [issue("MALFORMED_INPUT", "$", "Research pack must be an object.")] };
  }
  const pack = input as Partial<ResearchPack>;
  const hospitalsList = pack.hospitals;
  const reports = pack.hospital_year_reports;
  const sources = pack.sources;
  if (!Array.isArray(hospitalsList) || !Array.isArray(reports) || !sources || typeof sources !== "object") {
    return {
      ok: false,
      errors: [issue("MALFORMED_INPUT", "$", "Research pack must include hospitals, hospital_year_reports, and sources.")],
    };
  }
  if (reports.length === 0) {
    return { ok: false, errors: [issue("EMPTY_DATASET", "$.hospital_year_reports", "No hospital-year reports found.")] };
  }

  const hospitals = new Map<string, ResearchHospital>();
  hospitalsList.forEach((hospital, index) => {
    const path = `$.hospitals[${index}]`;
    if (hospital == null || typeof hospital !== "object") {
      errors.push(issue("MALFORMED_INPUT", path, "Hospital entries cannot be null. Null was not coerced to a missing hospital."));
      return;
    }
    if (typeof hospital.hospital_id !== "string" || hospital.hospital_id.trim() === "") {
      errors.push(issue("MISSING_REQUIRED_FIELD", `${path}.hospital_id`, "hospital_id is required."));
      return;
    }
    hospitals.set(hospital.hospital_id, hospital);
  });

  const observations: HospitalExtractRecord[] = [];

  reports.forEach((report, index) => {
    const path = `$.hospital_year_reports[${index}]`;
    if (report == null || typeof report !== "object") {
      errors.push(issue("MALFORMED_INPUT", path, "Report entries cannot be null. Null was not coerced to a missing report."));
      return;
    }
    const hospital = hospitals.get(report.hospital_id);
    if (!hospital) {
      errors.push(issue("MISSING_REQUIRED_FIELD", `${path}.hospital_id`, `Unknown hospital_id ${report.hospital_id}.`));
      return;
    }
    if (typeof report.source_id !== "string" || report.source_id.trim() === "") {
      errors.push(issue("MISSING_REQUIRED_FIELD", `${path}.source_id`, "source_id is required."));
      return;
    }
    if (!(report.source_id in sources)) {
      errors.push(
        issue(
          "DANGLING_REFERENCE",
          `${path}.source_id`,
          `Unresolved source reference "${report.source_id}". Missing sources are not treated as present.`,
        ),
      );
      return;
    }
    const fields = report.original_cms_fields;
    if (!fields || typeof fields !== "object") {
      errors.push(issue("MISSING_REQUIRED_FIELD", `${path}.original_cms_fields`, "original_cms_fields is required."));
      return;
    }

    const parsed: Partial<HospitalFinancials> = {};
    const sourceFieldMap: Record<string, string> = {};
    (Object.entries(CMS_NUMERIC) as [keyof typeof CMS_NUMERIC, string][]).forEach(([target, cmsName]) => {
      if (!cmsName) return;
      const result = parseCmsNumeric(fields[cmsName], `${path}.original_cms_fields["${cmsName}"]`);
      if (result.error) errors.push(result.error);
      if (target !== "serviceToPatientsIncome") {
        parsed[target] = result.value;
        sourceFieldMap[target] = cmsName;
      }
    });

    const financials: HospitalFinancials = {
      netPatientRevenue: parsed.netPatientRevenue ?? null,
      operatingRevenue: null,
      operatingExpenses: parsed.operatingExpenses ?? null,
      operatingIncome: null,
      operatingMargin: null,
      totalAssets: parsed.totalAssets ?? null,
      totalLiabilities: parsed.totalLiabilities ?? null,
      currentAssets: parsed.currentAssets ?? null,
      currentLiabilities: parsed.currentLiabilities ?? null,
      cash: parsed.cash ?? null,
      inpatientDays: parsed.inpatientDays ?? null,
      discharges: parsed.discharges ?? null,
      availableBeds: parsed.availableBeds ?? null,
      bedDaysAvailable: parsed.bedDaysAvailable ?? null,
      uncompensatedCare: parsed.uncompensatedCare ?? null,
    };

    const source = sources[report.source_id];
    const cmsStreet = typeof fields["Street Address"] === "string" ? fields["Street Address"] : null;
    const currentAddress = hospital.address;
    const addressMismatch = Boolean(
      cmsStreet && currentAddress && cmsStreet.replace(/\s+/g, " ").toUpperCase() !== currentAddress.split(",")[0]?.trim().toUpperCase(),
    );
    const addressEvidence: AddressEvidence[] = [];
    if (cmsStreet) {
      addressEvidence.push({
        role: "cms_cost_report",
        address: cmsStreet,
        source: source?.url ?? report.source_id,
        retrievedAt: source?.accessed ?? "2026-09-11",
        verification: "supported",
      });
    }
    if (hospital.hospital_id === "KY-LIC-100620") {
      addressEvidence.push({
        role: "other_directory",
        address: "540 JETT DRIVE",
        source: "Current CMS / KY directory identity (research pack), accessed 2026-09-11",
        retrievedAt: "2026-09-11",
        verification: "supported",
      });
    }

    const identityUnresolved =
      hospital.current_ccn !== hospital.historical_cost_report_ccn || addressMismatch;

    observations.push({
      id: `${report.hospital_id}:${report.report_record_id}`,
      hospitalId: report.hospital_id,
      ccn: report.ccn_as_reported,
      currentCcn: hospital.current_ccn,
      historicalCcn: hospital.historical_cost_report_ccn,
      ccnAsReported: report.ccn_as_reported,
      name: hospital.official_name,
      city: cityFromAddress(hospital.address, String(fields.City ?? "")),
      state: hospital.state,
      zip: zipFromCms(fields["Zip Code"]),
      county: hospital.county,
      countyFips: typeof hospital.county_fips === "string" ? hospital.county_fips : null,
      ownershipCategory: typeof hospital.ownership_category === "string" ? hospital.ownership_category : null,
      ruralClassification: typeof hospital.rural_classification === "string" ? hospital.rural_classification : null,
      address: cmsStreet,
      fiscalYearStart: report.fiscal_start,
      fiscalYearEnd: report.fiscal_end,
      reportRecordId: report.report_record_id,
      fileCohort: report.file_cohort,
      sourceId: report.source_id,
      sourceUrl: source?.url ?? null,
      publicationDate: source?.publication_date ?? null,
      reportingScope: report.scope ?? null,
      periodDays: report.period_days,
      identityReviewStatus: identityUnresolved ? "unresolved" : "clear",
      classification: "observed",
      provenance: {
        source: source?.url ?? report.source_id,
        retrievedAt: source?.accessed ?? "2026-09-11",
        notes: [
          report.scope,
          source?.limitations ?? null,
          `file_cohort=${report.file_cohort}`,
          `report_record_id=${report.report_record_id}`,
          hospital.historical_link_status,
        ]
          .filter(Boolean)
          .join(" "),
      },
      sourceFieldMap,
      sourceFields: { ...fields },
      financials,
      cmsCostReportAddress: cmsStreet,
      otherDirectoryAddress: hospital.hospital_id === "KY-LIC-100620" ? "540 JETT DRIVE" : hospital.address.split(",")[0] ?? null,
      addressEvidence,
      metricDefinitions: {
        netPatientRevenue: "CMS Net Patient Revenue (USD). Not total revenue.",
        operatingExpenses: "CMS Less Total Operating Expense (USD). Patient-care operating expense, not a validated overall operating total.",
        patientServiceResult:
          "Derived: Net Income from Service to Patients / Net Patient Revenue. Historical patient-care result, not a validated overall operating margin.",
        cash: "CMS Cash on Hand and in Banks (USD). Negative balances are preserved.",
        volume: "CMS Total Days / Total Bed Days Available for the fiscal report. Not Kentucky calendar-year utilization.",
      },
      outcomeStatus: hospital.outcome_missingness,
      dataQualityWarnings:
        hospital.current_ccn !== hospital.historical_cost_report_ccn
          ? [
              `Historical cost-report CCN ${hospital.historical_cost_report_ccn} differs from current CCN ${hospital.current_ccn}. Transition timing is unresolved.`,
            ]
          : [],
      identityDiscrepancies:
        hospital.hospital_id === "KY-LIC-100620"
          ? [
              {
                kind: "ccn_conflict",
                description:
                  "Historical cost-report CCN is 180139. Current CCN is 181334. CAH designation was announced 2025-01-07; the exact CCN switch date is unknown.",
                resolved: false,
              },
              {
                kind: "address_change",
                description:
                  "Historical CMS cost-report street is 400 JETT DRIVE. Current directory/CMS identity is 540 JETT DRIVE. This is an identity discrepancy only.",
                resolved: false,
              },
            ]
          : [],
    });
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    errors,
    extract: {
      disclaimer:
        `CMS Hospital Provider Cost Report rows for ${hospitals.size} Kentucky hospitals, ${reports.length} fiscal reports. Original CMS strings preserved. Event evidence is separate. Operating margin not calculated.`,
      source: "CMS research extracts; per-report URLs and access dates preserved in provenance",
      retrievedAt: "2026-09-11",
      sourceVerification: "pending",
      missingEvidence: [
        "Revised CMS cost-report CSV publication dates are unverified (publication_date null).",
        "Reporting-entity vs parent consolidation scope is not independently reconciled.",
        "Acquisition, bankruptcy, closure, and service-reduction outcomes are not yet verified.",
        "Kentucky River CCN transition effective date is unknown.",
      ],
      observations,
    },
  };
}
