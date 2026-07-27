import { describe, expect, it } from "vitest";
import { sumMoney } from "@systems-credit/domain";

import { createApp } from "../src/app";
import { createStaticAuthVerifier } from "../src/middleware/auth";
import { createMemoryFinanceRepository } from "../src/services/finance-repository";

const ownerId = "11111111-1111-4111-8111-111111111111";
const headers = {
  authorization: "Bearer owner-token",
  "content-type": "application/json"
};

async function setup() {
  const app = createApp({
    authVerifier: createStaticAuthVerifier({
      "owner-token": ownerId
    }),
    financeRepository: createMemoryFinanceRepository()
  });
  const workspaceResponse = await app.request(
    "/v1/workspaces/private",
    {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "การเงินของฉัน" })
    }
  );
  const workspace = await workspaceResponse.json<{
    workspace: { id: string };
    categories: Array<{ id: string; slug: string }>;
  }>();
  const accountResponse = await app.request("/v1/accounts", {
    method: "POST",
    headers,
    body: JSON.stringify({
      workspaceId: workspace.workspace.id,
      name: "บัญชีจ่ายหนี้",
      type: "bank",
      currency: "THB",
      openingBalance: "50000.00"
    })
  });
  const account = await accountResponse.json<{
    account: { id: string };
  }>();
  return {
    app,
    workspaceId: workspace.workspace.id,
    accountId: account.account.id,
    interestCategoryId: workspace.categories.find(
      (category) => category.slug === "debt-interest"
    )!.id
  };
}

async function createInstallment(
  context: Awaited<ReturnType<typeof setup>>,
  overrides: Record<string, unknown> = {}
) {
  return context.app.request("/v1/installments", {
    method: "POST",
    headers,
    body: JSON.stringify({
      workspaceId: context.workspaceId,
      name: "หนี้ทดสอบ",
      kind: "debt",
      originalPrincipal: "12000.00",
      downPayment: "0.00",
      financedFees: "0.00",
      currency: "THB",
      interestMethod: "flat",
      annualRate: "12",
      periods: 12,
      firstDueDate: "2026-08-01",
      interestCategoryId: context.interestCategoryId,
      clientMutationId:
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ...overrides
    })
  });
}

describe("installment Worker routes", () => {
  it("creates one exact schedule when the mutation is retried", async () => {
    const context = await setup();

    const first = await createInstallment(context);
    const retry = await createInstallment(context);

    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    const created = await first.json<{
      contract: { id: string; version: number };
      schedule: Array<{
        principal: string;
        interest: string;
        closingPrincipal: string;
      }>;
    }>();
    const replayed = await retry.json<{
      contract: { id: string };
    }>();
    expect(replayed.contract.id).toBe(created.contract.id);
    expect(created.contract.version).toBe(1);
    expect(created.schedule).toHaveLength(12);
    expect(
      sumMoney(
        created.schedule.map((row) => ({
          amount: row.principal,
          currency: "THB"
        }))
      ).amount
    ).toBe("12000.00");
    expect(
      sumMoney(
        created.schedule.map((row) => ({
          amount: row.interest,
          currency: "THB"
        }))
      ).amount
    ).toBe("1440.00");
    expect(created.schedule.at(-1)?.closingPrincipal).toBe("0.00");
  });

  it("posts an installment payment once and rejects a stale version", async () => {
    const context = await setup();
    const createdResponse = await createInstallment(context, {
      originalPrincipal: "100.00",
      interestMethod: "manual",
      annualRate: "0",
      periods: 1,
      manualRows: [
        {
          dueDate: "2026-08-01",
          principal: "100.00",
          interest: "20.00",
          fees: "5.00"
        }
      ]
    });
    const created = await createdResponse.json<{
      contract: { id: string };
    }>();
    const paymentBody = {
      workspaceId: context.workspaceId,
      sequence: 1,
      accountId: context.accountId,
      amount: "35.00",
      penaltyAmount: "10.00",
      currency: "THB",
      financialDate: "2026-08-01",
      expectedVersion: 1,
      clientMutationId:
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    };
    const request = (body = paymentBody) =>
      context.app.request(
        `/v1/installments/${created.contract.id}/payments`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(body)
        }
      );

    const first = await request();
    const retry = await request();
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      allocation: {
        penalty: "10.00",
        fees: "5.00",
        interest: "20.00",
        principal: "0.00",
        total: "35.00"
      },
      contractStatus: "active",
      contractVersion: 2,
      accountBalance: {
        accountId: context.accountId,
        amount: "49965.00"
      }
    });

    const stale = await request({
      ...paymentBody,
      amount: "100.00",
      clientMutationId:
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      error: { code: "STALE_VERSION" }
    });
  });

  it("posts an accepted early-payoff quote without expensing principal", async () => {
    const context = await setup();
    const createdResponse = await createInstallment(context);
    const created = await createdResponse.json<{
      contract: { id: string };
    }>();

    const response = await context.app.request(
      `/v1/installments/${created.contract.id}/payoff`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          workspaceId: context.workspaceId,
          accountId: context.accountId,
          action: "payoff",
          expectedRemainingPrincipal: "12000.00",
          quotedInterest: "500.00",
          quotedFees: "100.00",
          currency: "THB",
          financialDate: "2026-07-27",
          expectedVersion: 1,
          clientMutationId:
            "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
        })
      }
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      principalPayment: "12000.00",
      interestDue: "500.00",
      feesDue: "100.00",
      reportableExpense: "600.00",
      totalCashRequired: "12600.00",
      interestSaved: "940.00",
      contractStatus: "paid_off",
      contractVersion: 2,
      accountBalance: {
        accountId: context.accountId,
        amount: "37400.00"
      }
    });
  });
});
