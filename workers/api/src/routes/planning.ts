import {
  archiveSavingsGoalSchema,
  createSavingsGoalSchema,
  initializeBudgetMonthSchema,
  removeMonthlyBudgetSchema,
  setMonthlyBudgetSchema,
  updateSavingsGoalSchema
} from "@systems-credit/contracts";
import { Hono } from "hono";
import { z } from "zod";

import { ApiError } from "../api-error";
import type { PlanningRepository } from "../services/planning-repository";
import type { AppEnv } from "../types";

const uuidSchema = z.string().uuid();
const monthSchema = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/);

function invalid(): never {
  throw new ApiError(
    "VALIDATION_FAILED",
    400,
    "ข้อมูลแผนการเงินไม่ถูกต้อง"
  );
}

async function body(context: {
  req: { json(): Promise<unknown> };
}) {
  return context.req.json().catch(() => null);
}

export function planningRoutes(repository: PlanningRepository) {
  const routes = new Hono<AppEnv>();

  routes.get("/:month", async (context) => {
    const month = monthSchema.safeParse(context.req.param("month"));
    const workspaceId = uuidSchema.safeParse(
      context.req.query("workspaceId")
    );
    if (!month.success || !workspaceId.success) return invalid();
    return context.json(
      await repository.getPlan(
        context.get("auth"),
        workspaceId.data,
        month.data
      )
    );
  });

  routes.post("/budgets/initialize", async (context) => {
    const parsed = initializeBudgetMonthSchema.safeParse(
      await body(context)
    );
    if (!parsed.success) return invalid();
    return context.json(
      await repository.initializeMonth(context.get("auth"), parsed.data)
    );
  });

  routes.post("/budgets", async (context) => {
    const parsed = setMonthlyBudgetSchema.safeParse(await body(context));
    if (!parsed.success) return invalid();
    return context.json(
      await repository.setBudget(context.get("auth"), parsed.data)
    );
  });

  routes.post("/budgets/:id/remove", async (context) => {
    const id = uuidSchema.safeParse(context.req.param("id"));
    const parsed = removeMonthlyBudgetSchema.safeParse(
      await body(context)
    );
    if (!id.success || !parsed.success) return invalid();
    return context.json(
      await repository.removeBudget(
        context.get("auth"),
        id.data,
        parsed.data
      )
    );
  });

  routes.post("/goals", async (context) => {
    const parsed = createSavingsGoalSchema.safeParse(await body(context));
    if (!parsed.success) return invalid();
    return context.json(
      await repository.createGoal(context.get("auth"), parsed.data),
      201
    );
  });

  routes.patch("/goals/:id", async (context) => {
    const id = uuidSchema.safeParse(context.req.param("id"));
    const parsed = updateSavingsGoalSchema.safeParse(await body(context));
    if (!id.success || !parsed.success) return invalid();
    return context.json(
      await repository.updateGoal(
        context.get("auth"),
        id.data,
        parsed.data
      )
    );
  });

  routes.post("/goals/:id/archive", async (context) => {
    const id = uuidSchema.safeParse(context.req.param("id"));
    const parsed = archiveSavingsGoalSchema.safeParse(
      await body(context)
    );
    if (!id.success || !parsed.success) return invalid();
    return context.json(
      await repository.archiveGoal(
        context.get("auth"),
        id.data,
        parsed.data
      )
    );
  });

  return routes;
}
