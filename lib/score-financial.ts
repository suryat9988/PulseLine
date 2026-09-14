import { scoringConfig } from "./scoring-config.ts";
import type {
  DataCoverage,
  FactorAvailability,
  FinancialDistressResult,
  FinancialStatus,
  Hospital,
  ScoreFactor,
} from "../src/types.ts";

type FactorConfig = (typeof scoringConfig.factors)[keyof typeof scoringConfig.factors];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isPresent(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function linearRisk(value: number, factor: FactorConfig): number {
  const { healthy, concern, direction } = factor;
  if (direction === "lower_is_riskier") {
    if (value >= healthy) return 0;
    if (value <= concern) return 100;
    return (100 * (healthy - value)) / (healthy - concern);
  }
  if (value <= healthy) return 0;
  if (value >= concern) return 100;
  return (100 * (value - healthy)) / (concern - healthy);
}

function statusForScore(score: number | null): FinancialStatus {
  if (score === null) return "Insufficient data";
  if (score <= scoringConfig.statusThresholds.stableMax) return "Stable";
  if (score <= scoringConfig.statusThresholds.watchMax) return "Watch";
  return "High Concern";
}

function coverageForCount(available: number): DataCoverage {
  if (available === 0) return "None";
  if (available >= scoringConfig.dataCoverage.highMinAvailable) return "High";
  if (available >= scoringConfig.dataCoverage.moderateMinAvailable) return "Moderate";
  return "Low";
}

function reconstructReason(factor: {
  config: FactorConfig;
  rawValue: number | null;
  risk: number | null;
  availability: FactorAvailability;
  exclusion: string | null;
  effectiveWeight: number | null;
  weightedPoints: number | null;
}): string {
  if (factor.availability !== "available" || factor.rawValue === null || factor.risk === null) {
    return factor.exclusion ?? "Not available in current dataset";
  }
  const direction =
    factor.config.direction === "lower_is_riskier" ? "lower values raise risk" : "higher values raise risk";
  const narrative =
    factor.config.id === "operating_margin" && factor.rawValue < 0
      ? "Reported operating margin is negative."
      : factor.config.id === "expense_pressure" && factor.rawValue > 1
        ? "Less Total Operating Expense exceeded Net Patient Revenue."
        : factor.config.id === "leverage" && factor.rawValue >= 0.7
          ? "Liabilities represent a high proportion of reported assets."
          : factor.config.id === "patient_volume" && factor.risk >= 50
            ? "Inpatient utilization is low relative to reported bed-days available."
            : `${factor.config.label} was scored from the available extract field.`;
  return [
    narrative,
    `Raw value ${factor.rawValue}.`,
    `Formula: ${factor.config.formula}.`,
    `Healthy anchor ${factor.config.healthy}; concern anchor ${factor.config.concern} (${direction}).`,
    `Factor risk ${factor.risk.toFixed(2)} / 100.`,
    `Base weight ${factor.config.weight}.`,
    `Effective weight ${factor.effectiveWeight?.toFixed(4) ?? "n/a"}.`,
    `Weighted points ${factor.weightedPoints?.toFixed(2) ?? "n/a"}.`,
  ].join(" ");
}

function unfinishedFactor(
  config: FactorConfig,
  rawValue: number | null,
  source: string,
  availability: FactorAvailability,
  exclusion: string,
): ScoreFactor {
  return {
    id: config.id,
    metric: config.label,
    rawValue,
    formula: config.formula,
    healthy: config.healthy,
    concern: config.concern,
    direction: config.direction,
    normalizedRisk: null,
    baseWeight: config.weight,
    effectiveWeight: null,
    weightedPoints: null,
    reason: reconstructReason({
      config,
      rawValue,
      risk: null,
      availability,
      exclusion,
      effectiveWeight: null,
      weightedPoints: null,
    }),
    source,
    available: false,
    availability,
    exclusion,
  };
}

function scoredFactor(
  config: FactorConfig,
  rawValue: number,
  source: string,
): Omit<ScoreFactor, "effectiveWeight" | "weightedPoints" | "reason"> & {
  effectiveWeight: null;
  weightedPoints: null;
} {
  return {
    id: config.id,
    metric: config.label,
    rawValue,
    formula: config.formula,
    healthy: config.healthy,
    concern: config.concern,
    direction: config.direction,
    normalizedRisk: clamp(linearRisk(rawValue, config), 0, 100),
    baseWeight: config.weight,
    effectiveWeight: null,
    weightedPoints: null,
    source,
    available: true,
    availability: "available",
    exclusion: null,
  };
}

/**
 * Transparent financial stress score.
 * Missing, invalid, and unsupported inputs are excluded. Nulls are never treated as zero.
 * A hospital with no scorable factors receives a null score and Insufficient data.
 */
export function scoreFinancialDistress(hospital: Hospital): FinancialDistressResult {
  const { financials, sourceFieldMap } = hospital;
  const limitations: string[] = [
    "Experimental hackathon score, not a validated bankruptcy or closure predictor.",
    "Thresholds and labels are experimental assumptions.",
    "Only metrics that are present, valid, and definitionally supported are scored.",
  ];

  const factors: ScoreFactor[] = [];

  if (isPresent(financials.operatingMargin)) {
    factors.push({
      ...scoredFactor(
        scoringConfig.factors.operatingMargin,
        financials.operatingMargin,
        sourceFieldMap.operatingMargin ?? "operating_margin",
      ),
      reason: "",
    });
  } else if (isPresent(financials.netPatientRevenue) && isPresent(financials.operatingExpenses)) {
    factors.push(
      unfinishedFactor(
        scoringConfig.factors.operatingMargin,
        null,
        scoringConfig.factors.operatingMargin.formula,
        "unsupported",
        "Excluded: patient-care result is not a validated overall operating margin.",
      ),
    );
  } else {
    factors.push(
      unfinishedFactor(
        scoringConfig.factors.operatingMargin,
        financials.operatingMargin,
        sourceFieldMap.operatingMargin ?? "operating_margin",
        "unavailable",
        "Operating margin is unavailable in the current extract.",
      ),
    );
  }

  const expenseBase = isPresent(financials.netPatientRevenue)
    ? financials.netPatientRevenue
    : financials.operatingRevenue;
  const expenseAmount = financials.operatingExpenses;
  const expenseSource =
    sourceFieldMap.operatingExpenses && (sourceFieldMap.netPatientRevenue ?? sourceFieldMap.operatingRevenue)
      ? `${sourceFieldMap.operatingExpenses} / ${sourceFieldMap.netPatientRevenue ?? sourceFieldMap.operatingRevenue}`
      : scoringConfig.factors.expensePressure.formula;

  if (!isPresent(expenseAmount) || !isPresent(expenseBase)) {
    const unsupported =
      hospital.sourceFields["hcris.total_costs"] != null || hospital.sourceFields["hcris.total_revenues"] != null;
    factors.push(
      unfinishedFactor(
        scoringConfig.factors.expensePressure,
        null,
        scoringConfig.factors.expensePressure.formula,
        unsupported ? "unsupported" : "unavailable",
        unsupported
          ? "Excluded: the extract has total revenues/costs, not Net Patient Revenue / Less Total Operating Expense."
          : "Net Patient Revenue and Less Total Operating Expense are unavailable, so patient-service expense pressure was not calculated.",
      ),
    );
  } else if (expenseBase <= 0) {
    factors.push(
      unfinishedFactor(
        scoringConfig.factors.expensePressure,
        expenseBase === 0 ? null : expenseAmount / expenseBase,
        expenseSource,
        "invalid",
        "Invalid: Net Patient Revenue is zero or negative, so expense/revenue is not a usable patient-service ratio.",
      ),
    );
  } else {
    factors.push({
      ...scoredFactor(scoringConfig.factors.expensePressure, expenseAmount / expenseBase, expenseSource),
      reason: "",
    });
  }

  if (!isPresent(financials.totalLiabilities) || !isPresent(financials.totalAssets)) {
    factors.push(
      unfinishedFactor(
        scoringConfig.factors.leverage,
        null,
        "totalLiabilities / totalAssets",
        "unavailable",
        "Total assets and/or total liabilities are unavailable.",
      ),
    );
  } else if (financials.totalAssets <= 0) {
    factors.push(
      unfinishedFactor(
        scoringConfig.factors.leverage,
        financials.totalLiabilities / financials.totalAssets,
        "totalLiabilities / totalAssets",
        "invalid",
        "Invalid: total assets are zero or negative, so liabilities/assets is not interpretable.",
      ),
    );
  } else if (financials.totalLiabilities < 0) {
    factors.push(
      unfinishedFactor(
        scoringConfig.factors.leverage,
        financials.totalLiabilities,
        "totalLiabilities / totalAssets",
        "invalid",
        "Invalid: published total liabilities are negative, so the liabilities-to-assets ratio was not scored.",
      ),
    );
  } else {
    factors.push({
      ...scoredFactor(
        scoringConfig.factors.leverage,
        financials.totalLiabilities / financials.totalAssets,
        sourceFieldMap.totalLiabilities && sourceFieldMap.totalAssets
          ? `${sourceFieldMap.totalLiabilities} / ${sourceFieldMap.totalAssets}`
          : "totalLiabilities / totalAssets",
      ),
      reason: "",
    });
  }

  if (!isPresent(financials.currentAssets) || !isPresent(financials.currentLiabilities)) {
    factors.push(
      unfinishedFactor(
        scoringConfig.factors.currentRatio,
        null,
        "currentAssets / currentLiabilities",
        "unavailable",
        "Current assets and current liabilities are unavailable in the current extract.",
      ),
    );
  } else if (financials.currentLiabilities <= 0) {
    factors.push(
      unfinishedFactor(
        scoringConfig.factors.currentRatio,
        financials.currentLiabilities,
        "currentAssets / currentLiabilities",
        "invalid",
        financials.currentLiabilities < 0
          ? "Invalid: published current liabilities are negative, so the current ratio was not scored. The negative balance was preserved."
          : "Invalid: current liabilities are zero, so the current ratio was not scored.",
      ),
    );
  } else {
    factors.push({
      ...scoredFactor(
        scoringConfig.factors.currentRatio,
        financials.currentAssets / financials.currentLiabilities,
        "currentAssets / currentLiabilities",
      ),
      reason: "",
    });
  }

  if (!isPresent(financials.cash) || !isPresent(financials.operatingExpenses)) {
    factors.push(
      unfinishedFactor(
        scoringConfig.factors.liquidity,
        null,
        "cash / operatingExpenses",
        "unavailable",
        "Cash and/or operating expenses are unavailable, so liquidity was not scored.",
      ),
    );
  } else if (financials.cash < 0) {
    factors.push(
      unfinishedFactor(
        scoringConfig.factors.liquidity,
        financials.cash,
        "cash / operatingExpenses",
        "invalid",
        "Invalid: Cash on Hand and in Banks is negative, so cash / expenses is not a usable liquidity ratio. The negative balance was preserved and not treated as zero.",
      ),
    );
  } else if (financials.operatingExpenses <= 0) {
    factors.push(
      unfinishedFactor(
        scoringConfig.factors.liquidity,
        financials.cash / financials.operatingExpenses,
        "cash / operatingExpenses",
        "invalid",
        "Invalid: Less Total Operating Expense is zero or negative, so cash / expenses is not interpretable.",
      ),
    );
  } else {
    factors.push({
      ...scoredFactor(
        scoringConfig.factors.liquidity,
        financials.cash / financials.operatingExpenses,
        "cash / operatingExpenses",
      ),
      reason: "",
    });
  }

  if (!isPresent(financials.inpatientDays) || !isPresent(financials.bedDaysAvailable)) {
    const exclusion = isPresent(financials.availableBeds) && !isPresent(financials.bedDaysAvailable)
      ? "Unsupported: PulseLine does not assume a 365-day reporting period from bed count. Bed-days available are required."
      : "Inpatient days and/or bed-days available are unavailable.";
    factors.push(
      unfinishedFactor(
        scoringConfig.factors.volume,
        null,
        "inpatientDays / bedDaysAvailable",
        isPresent(financials.availableBeds) && !isPresent(financials.bedDaysAvailable)
          ? "unsupported"
          : "unavailable",
        exclusion,
      ),
    );
  } else if (financials.bedDaysAvailable <= 0 || financials.inpatientDays < 0) {
    factors.push(
      unfinishedFactor(
        scoringConfig.factors.volume,
        null,
        "inpatientDays / bedDaysAvailable",
        "invalid",
        "Invalid: bed-days available must be positive and inpatient days cannot be negative.",
      ),
    );
  } else {
    factors.push({
      ...scoredFactor(
        scoringConfig.factors.volume,
        financials.inpatientDays / financials.bedDaysAvailable,
        sourceFieldMap.inpatientDays && sourceFieldMap.bedDaysAvailable
          ? `${sourceFieldMap.inpatientDays} / ${sourceFieldMap.bedDaysAvailable}`
          : "inpatientDays / bedDaysAvailable",
      ),
      reason: "",
    });
  }

  const available = factors.filter((factor) => factor.available && factor.normalizedRisk !== null);
  const weightSum = available.reduce((sum, factor) => sum + factor.baseWeight, 0);
  let unroundedScore: number | null = null;
  if (weightSum > 0) {
    unroundedScore = available.reduce((sum, factor) => {
      return sum + ((factor.normalizedRisk as number) * factor.baseWeight) / weightSum;
    }, 0);
  }

  const roundedScore = unroundedScore === null ? null : Math.round(clamp(unroundedScore, 0, 100));

  const finalized = factors.map((factor) => {
    if (!factor.available || factor.normalizedRisk === null || weightSum === 0) {
      return factor;
    }
    const effectiveWeight = factor.baseWeight / weightSum;
    const weightedPoints = factor.normalizedRisk * effectiveWeight;
    const next = { ...factor, effectiveWeight, weightedPoints };
    return {
      ...next,
      reason: reconstructReason({
        config: Object.values(scoringConfig.factors).find((item) => item.id === factor.id) as FactorConfig,
        rawValue: factor.rawValue,
        risk: factor.normalizedRisk,
        availability: "available",
        exclusion: null,
        effectiveWeight,
        weightedPoints,
      }),
    };
  });

  const exclusions = finalized
    .filter((factor) => factor.availability !== "available")
    .map((factor) => `${factor.metric}: ${factor.exclusion}`);

  const activeIds = available.map((factor) => factor.id);
  const correlatedFactors = scoringConfig.correlatedFactorGroups
    .filter((group) => group.ids.every((id) => activeIds.includes(id)))
    .map((group) => group.note);
  if (correlatedFactors.length > 0) {
    limitations.push(...correlatedFactors);
  }

  const dataCoverage = coverageForCount(available.length);
  if (roundedScore === null) {
    limitations.push("No scorable financial metrics were present. The score is null and the status is Insufficient data, not Stable.");
  }

  return {
    score: roundedScore,
    status: statusForScore(roundedScore),
    dataCoverage,
    factors: finalized,
    missingInputs: finalized
      .filter((factor) => factor.availability === "unavailable")
      .map((factor) => factor.metric),
    exclusions,
    limitations,
    reconstruction: {
      availableFactorIds: activeIds,
      weightSum,
      unroundedScore,
      roundedScore,
      rounding: scoringConfig.rounding,
      correlatedFactors,
      coverageNote: `Data coverage is ${dataCoverage} because ${available.length} of ${finalized.length} factors were scored. Coverage can differ across hospitals when fields are missing, invalid, or unsupported.`,
    },
  };
}

export function flaggedExplanations(result: FinancialDistressResult): string[] {
  if (result.score === null) {
    return ["Insufficient data: no financial factor could be scored, so no stress status was assigned."];
  }
  return result.factors
    .filter((factor) => factor.available && (factor.normalizedRisk ?? 0) >= 50)
    .map((factor) => factor.reason);
}

export function rankHospitalViews<T extends { financial: FinancialDistressResult }>(views: T[]): T[] {
  return [...views].sort((left, right) => {
    if (left.financial.score === null && right.financial.score === null) return 0;
    if (left.financial.score === null) return 1;
    if (right.financial.score === null) return -1;
    return right.financial.score - left.financial.score;
  });
}
