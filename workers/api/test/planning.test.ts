import type {
  FinancialPlan,
  PlanningRepository
} from "../src/services/planning-repository";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { createStaticAuthVerifier } from "../src/middleware/auth";
import { createMemoryFinanceRepository } from "../src/services/finance-repository";

const ownerId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const categoryId = "33333333-3333-4333-8333-333333333333";
const accountId = "44444444-4444-4444-8444-444444444444";

const plan: FinancialPlan = {
  workspaceId,
  month: "2026-08",
  currency: "THB",
  totals: {
    baseBudget: "0.00",
    priorCarry: "0.00",
    available: "0.00",
    spent: "0.00",
    remaining: "0.00"
  },
  categories: [],
  goals: []
};

function setup() {
  const planningRepository: PlanningRepository = {
    getPlan: vi.fn().mockResolvedValue(plan),
    initializeMonth: vi.fn().mockResolvedValue({ createdCount: 0 }),
    setBudget: vi.fn().mockResolvedValue({
      id: "55555555-5555-4555-8555-555555555555",
      workspaceId,
      categoryId,
      month: "2026-08",
      amount: "5000.00",
      version: 1
    }),
    removeBudget: vi.fn(),
    createGoal: vi.fn().mockResolvedValue({
      id: "66666666-6666-4666-8666-666666666666",
      workspaceId,
      name: "เงินฉุกเฉิน",
      targetAmount: "50000.00",
      currency: "THB",
      accountId,
      accountType: "bank",
      status: "active",
      version: 1
    }),
    updateGoal: vi.fn(),
    archiveGoal: vi.fn()
  };
  const app = createApp({
    authVerifier: createStaticAuthVerifier({ "owner-token": ownerId }),
    financeRepository: createMemoryFinanceRepository(),
    planningRepository
  });
  return { app, planningRepository };
}

const authHeaders = {
  authorization: "Bearer owner-token",
  "content-type": "application/json"
};

describe("financial planning Worker routes", () => {
  it("reads a validated month for an authenticated user", async () => {
    const { app, planningRepository } = setup();
    const response = await app.request(
      `/v1/planning/2026-08?workspaceId=${workspaceId}`,
      { headers: authHeaders }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(plan);
    expect(planningRepository.getPlan).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ownerId }),
      workspaceId,
      "2026-08"
    );
  });

  it("rejects malformed planning input before persistence", async () => {
    const { app, planningRepository } = setup();
    const invalidMonth = await app.request(
      `/v1/planning/2026-13?workspaceId=${workspaceId}`,
      { headers: authHeaders }
    );
    const zeroBudget = await app.request("/v1/planning/budgets", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        workspaceId,
        categoryId,
        month: "2026-08",
        amount: "0.00"
      })
    });

    expect(invalidMonth.status).toBe(400);
    expect(zeroBudget.status).toBe(400);
    expect(planningRepository.getPlan).not.toHaveBeenCalled();
    expect(planningRepository.setBudget).not.toHaveBeenCalled();
  });

  it("creates a goal and requires authentication", async () => {
    const { app } = setup();
    const body = {
      workspaceId,
      name: "เงินฉุกเฉิน",
      targetAmount: "50000.00",
      currency: "THB",
      accountId
    };
    const created = await app.request("/v1/planning/goals", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(body)
    });
    const unauthenticated = await app.request("/v1/planning/goals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });

    expect(created.status).toBe(201);
    expect(unauthenticated.status).toBe(401);
  });
});
