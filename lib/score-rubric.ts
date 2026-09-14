import { scoringConfig } from "./scoring-config.ts";
import type { FactorAvailability, FinancialDistressResult, FinancialStatus, ScoreFactor } from "../src/types.ts";

export const SCORE_NOT =
  "The score measures PulseLine’s defined financial concern indicators. It is not acquisition attractiveness, enterprise value, creditworthiness, probability of bankruptcy or closure, or a recommendation to transact.";

export interface RubricBand {
  label: Exclude<FinancialStatus, "Insufficient data">;
  min: number;
  max: number;
}

export interface RubricFactorRow {
  id: string;
  label: string;
  included: boolean;
  hospitalValue: number | null;
  unit: "ratio" | "percent" | "points";
  direction: ScoreFactor["direction"];
  healthy: number;
  concern: number;
  baseWeight: number;
  effectiveWeight: number | null;
  weightedPoints: number | null;
  normalizedRisk: number | null;
  availability: FactorAvailability;
  exclusion: string | null;
}

export interface ScoreRubric {
  roundedScore: number | null;
  unroundedScore: number | null;
  status: FinancialStatus;
  dataCoverage: FinancialDistressResult["dataCoverage"];
  bands: RubricBand[];
  included: RubricFactorRow[];
  excluded: RubricFactorRow[];
  weightSum: number;
  rounding: string;
  coverageNote: string;
  experimentalNote: string;
  notADealScore: string;
}

function unitFor(id: string): RubricFactorRow["unit"] {
  if (id === "operating_margin" || id === "patient_volume") return "percent";
  return "ratio";
}

function toRow(factor: ScoreFactor): RubricFactorRow {
  return {
    id: factor.id,
    label: factor.metric,
    included: factor.available && factor.weightedPoints !== null,
    hospitalValue: factor.rawValue,
    unit: unitFor(factor.id),
    direction: factor.direction,
    healthy: factor.healthy,
    concern: factor.concern,
    baseWeight: factor.baseWeight,
    effectiveWeight: factor.effectiveWeight,
    weightedPoints: factor.weightedPoints,
    normalizedRisk: factor.normalizedRisk,
    availability: factor.availability,
    exclusion: factor.exclusion,
  };
}

export function rubricBands(): RubricBand[] {
  const { stableMax, watchMax } = scoringConfig.statusThresholds;
  return [
    { label: "Stable", min: 0, max: stableMax },
    { label: "Watch", min: stableMax + 1, max: watchMax },
    { label: "High Concern", min: watchMax + 1, max: 100 },
  ];
}

export function buildScoreRubric(result: FinancialDistressResult): ScoreRubric {
  const rows = result.factors.map(toRow);
  return {
    roundedScore: result.score,
    unroundedScore: result.reconstruction.unroundedScore,
    status: result.status,
    dataCoverage: result.dataCoverage,
    bands: rubricBands(),
    included: rows.filter((row) => row.included),
    excluded: rows.filter((row) => !row.included),
    weightSum: result.reconstruction.weightSum,
    rounding: result.reconstruction.rounding,
    coverageNote: result.reconstruction.coverageNote,
    experimentalNote:
      "Thresholds and weights are experimental assumptions. Effective weights change when factors are excluded.",
    notADealScore: SCORE_NOT,
  };
}

export function includedPointsSum(rubric: ScoreRubric): number {
  return rubric.included.reduce((sum, row) => sum + (row.weightedPoints ?? 0), 0);
}
