import {
  createInstallmentContractSchema,
  postInstallmentPaymentSchema,
  postInstallmentPayoffSchema
} from "@systems-credit/contracts";
import { Hono } from "hono";
import { z } from "zod";

import { ApiError } from "../api-error";
import type { FinanceRepository } from "../services/finance-repository";
import type { AppEnv } from "../types";

const mutationSchema = z.object({
  clientMutationId: z.string().uuid(),
  expectedVersion: z.number().int().positive().optional()
});

const contractIdSchema = z.string().uuid();

function invalidRequest(): never {
  throw new ApiError(
    "VALIDATION_FAILED",
    400,
    "ข้อมูลรายการผ่อนชำระไม่ถูกต้อง"
  );
}

export function installmentRoutes(
  financeRepository: FinanceRepository
) {
  const routes = new Hono<AppEnv>();

  routes.post("/", async (context) => {
    const body = await context.req.json<Record<string, unknown>>()
      .catch(() => null);
    const metadata = mutationSchema
      .pick({ clientMutationId: true })
      .safeParse(body);
    if (!body || !metadata.success) {
      return invalidRequest();
    }

    const { clientMutationId: _clientMutationId, ...contractInput } =
      body;
    const parsed = createInstallmentContractSchema.safeParse(
      contractInput
    );
    if (!parsed.success) {
      return invalidRequest();
    }

    const result =
      await financeRepository.createInstallmentContract(
        context.get("auth"),
        parsed.data,
        metadata.data.clientMutationId
      );
    return context.json(
      result.response,
      result.replayed ? 200 : 201
    );
  });

  routes.post("/:contractId/payments", async (context) => {
    const contractId = contractIdSchema.safeParse(
      context.req.param("contractId")
    );
    const body = await context.req.json<Record<string, unknown>>()
      .catch(() => null);
    const metadata = mutationSchema.safeParse(body);
    if (
      !body ||
      !contractId.success ||
      !metadata.success ||
      metadata.data.expectedVersion === undefined
    ) {
      return invalidRequest();
    }

    const { expectedVersion: _expectedVersion, ...paymentBody } = body;
    const parsed = postInstallmentPaymentSchema.safeParse({
      ...paymentBody,
      contractId: contractId.data
    });
    if (!parsed.success) {
      return invalidRequest();
    }

    const result = await financeRepository.postInstallmentPayment(
      context.get("auth"),
      {
        ...parsed.data,
        expectedVersion: metadata.data.expectedVersion
      }
    );
    return context.json(
      result.response,
      result.replayed ? 200 : 201
    );
  });

  routes.post("/:contractId/payoff", async (context) => {
    const contractId = contractIdSchema.safeParse(
      context.req.param("contractId")
    );
    const body = await context.req.json<Record<string, unknown>>()
      .catch(() => null);
    const metadata = mutationSchema.safeParse(body);
    if (
      !body ||
      !contractId.success ||
      !metadata.success ||
      metadata.data.expectedVersion === undefined
    ) {
      return invalidRequest();
    }

    const { expectedVersion: _expectedVersion, ...payoffBody } = body;
    const parsed = postInstallmentPayoffSchema.safeParse({
      ...payoffBody,
      contractId: contractId.data
    });
    if (!parsed.success) {
      return invalidRequest();
    }

    const result = await financeRepository.postInstallmentPayoff(
      context.get("auth"),
      {
        ...parsed.data,
        expectedVersion: metadata.data.expectedVersion
      }
    );
    return context.json(
      result.response,
      result.replayed ? 200 : 201
    );
  });

  return routes;
}
