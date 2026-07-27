import { createTransferSchema } from "@systems-credit/contracts";
import { Hono } from "hono";

import { ApiError } from "../api-error";
import type { FinanceRepository } from "../services/finance-repository";
import type { AppEnv } from "../types";

export function transferRoutes(financeRepository: FinanceRepository) {
  const routes = new Hono<AppEnv>();

  routes.post("/", async (context) => {
    const parsed = createTransferSchema.safeParse(
      await context.req.json().catch(() => null)
    );
    if (!parsed.success) {
      throw new ApiError(
        "VALIDATION_FAILED",
        400,
        "ข้อมูลการโอนไม่ถูกต้อง"
      );
    }

    const result = await financeRepository.postTransfer(
      context.get("auth"),
      parsed.data
    );
    return context.json(
      result.response,
      result.replayed ? 200 : 201
    );
  });

  return routes;
}
