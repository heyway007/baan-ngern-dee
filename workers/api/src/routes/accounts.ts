import { createAccountSchema } from "@systems-credit/contracts";
import { Hono } from "hono";

import { ApiError } from "../api-error";
import type { FinanceRepository } from "../services/finance-repository";
import type { AppEnv } from "../types";

export function accountRoutes(financeRepository: FinanceRepository) {
  const routes = new Hono<AppEnv>();

  routes.post("/", async (context) => {
    const parsed = createAccountSchema.safeParse(
      await context.req.json().catch(() => null)
    );
    if (!parsed.success) {
      throw new ApiError(
        "VALIDATION_FAILED",
        400,
        "ข้อมูลบัญชีไม่ถูกต้อง"
      );
    }

    const account = await financeRepository.createAccount(
      context.get("auth").userId,
      parsed.data
    );
    return context.json({ account }, 201);
  });

  return routes;
}
