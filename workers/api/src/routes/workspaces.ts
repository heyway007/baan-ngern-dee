import { createPrivateWorkspaceSchema } from "@systems-credit/contracts";
import { Hono } from "hono";

import { ApiError } from "../api-error";
import type { FinanceRepository } from "../services/finance-repository";
import type { AppEnv } from "../types";

export function workspaceRoutes(financeRepository: FinanceRepository) {
  const routes = new Hono<AppEnv>();

  routes.post("/private", async (context) => {
    const parsed = createPrivateWorkspaceSchema.safeParse(
      await context.req.json().catch(() => null)
    );
    if (!parsed.success) {
      throw new ApiError(
        "VALIDATION_FAILED",
        400,
        "ข้อมูลพื้นที่ส่วนตัวไม่ถูกต้อง"
      );
    }

    const result = await financeRepository.createPrivateWorkspace(
      context.get("auth").userId,
      parsed.data
    );
    return context.json(result, 201);
  });

  return routes;
}
