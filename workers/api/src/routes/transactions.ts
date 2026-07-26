import {
  createTransactionSchema,
  voidTransactionSchema
} from "@systems-credit/contracts";
import { Hono } from "hono";

import { ApiError } from "../api-error";
import type { FinanceRepository } from "../services/finance-repository";
import type { AppEnv } from "../types";

export function transactionRoutes(
  financeRepository: FinanceRepository
) {
  const routes = new Hono<AppEnv>();

  routes.post("/", async (context) => {
    const parsed = createTransactionSchema.safeParse(
      await context.req.json().catch(() => null)
    );
    if (!parsed.success) {
      throw new ApiError(
        "VALIDATION_FAILED",
        400,
        "ข้อมูลรายการไม่ถูกต้อง"
      );
    }

    const result = await financeRepository.postTransaction(
      context.get("auth").userId,
      parsed.data
    );
    return context.json(result, 201);
  });

  routes.post("/:id/void", async (context) => {
    const transactionId = context.req.param("id");
    const parsed = voidTransactionSchema.safeParse(
      await context.req.json().catch(() => null)
    );
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        transactionId
      ) ||
      !parsed.success
    ) {
      throw new ApiError(
        "VALIDATION_FAILED",
        400,
        "ข้อมูลยกเลิกรายการไม่ถูกต้อง"
      );
    }

    const result = await financeRepository.voidTransaction(
      context.get("auth").userId,
      transactionId,
      parsed.data
    );
    return context.json(result);
  });

  return routes;
}
