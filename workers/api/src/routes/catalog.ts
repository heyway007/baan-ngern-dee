import { createCategorySchema } from "@systems-credit/contracts";
import { Hono } from "hono";

import { ApiError } from "../api-error";
import type { FinanceRepository } from "../services/finance-repository";
import type { AppEnv } from "../types";

export function catalogRoutes(financeRepository: FinanceRepository) {
  const routes = new Hono<AppEnv>();

  routes.post("/", async (context) => {
    const parsed = createCategorySchema.safeParse(
      await context.req.json().catch(() => null)
    );
    if (!parsed.success) {
      throw new ApiError(
        "VALIDATION_FAILED",
        400,
        "ข้อมูลหมวดหมู่ไม่ถูกต้อง"
      );
    }

    const category = await financeRepository.createCategory(
      context.get("auth").userId,
      parsed.data
    );
    return context.json({ category }, 201);
  });

  return routes;
}
