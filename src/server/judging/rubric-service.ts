import { z } from "zod";
import { weightedMean } from "../../db/schema";

export class RubricValidationError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = "RubricValidationError";
  }
}

export const rubricCriterionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  weight: z.number().gte(0),
});

function hasUniqueIds(criteria: Array<{ id: string }>): boolean {
  const seen = new Set<string>();
  for (const c of criteria) {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
  }
  return true;
}

function sumWeights(criteria: Array<{ weight: number }>): number {
  return criteria.reduce((sum, c) => sum + c.weight, 0);
}

function buildCriteriaSchema(legacy: boolean) {
  return z
    .array(rubricCriterionSchema)
    .min(1)
    .refine(hasUniqueIds, { message: "Duplicate criterion ids" })
    .refine((c) => legacy || Math.abs(sumWeights(c) - 100) < 1e-9, {
      message: "Sum of weights must equal 100",
    });
}

const criteriaSchemaStrict = buildCriteriaSchema(false);
const criteriaSchemaLegacy = buildCriteriaSchema(true);

export function validateRubricCriteria(
  criteria: unknown,
  opts: { legacy: boolean },
): z.infer<typeof rubricCriterionSchema>[] {
  const schema = opts.legacy ? criteriaSchemaLegacy : criteriaSchemaStrict;
  return schema.parse(criteria);
}

export function validateRubricCriteriaStrict(criteria: unknown): z.infer<typeof rubricCriterionSchema>[] {
  return criteriaSchemaStrict.parse(criteria);
}

export function calculateRawTotal(
  criteria: Array<{ id: string; weight: number }>,
  criterionScores: Record<string, number>,
): number {
  const criterionIds = new Set(criteria.map((c) => c.id));

  for (const c of criteria) {
    if (!(c.id in criterionScores)) {
      throw new RubricValidationError(
        `Missing score for criterion "${c.id}"`,
        "MISSING_CRITERION_SCORE",
      );
    }
  }

  for (const key of Object.keys(criterionScores)) {
    if (!criterionIds.has(key)) {
      throw new RubricValidationError(
        `Unknown criterion key: "${key}"`,
        "UNKNOWN_CRITERION",
      );
    }
  }

  for (const c of criteria) {
    const score = criterionScores[c.id];
    if (typeof score !== "number" || !Number.isFinite(score)) {
      throw new RubricValidationError(
        `Score for criterion "${c.id}" must be a finite number`,
        "INVALID_SCORE_TYPE",
      );
    }
    if (score < 0 || score > 100) {
      throw new RubricValidationError(
        `Score for criterion "${c.id}" must be between 0 and 100 inclusive`,
        "SCORE_OUT_OF_RANGE",
      );
    }
  }

  const weightedSum = weightedMean(criterionScores, criteria);
  return weightedSum / 100;
}
