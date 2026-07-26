import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { createStaticAuthVerifier } from "../src/middleware/auth";
import { createMemoryFinanceRepository } from "../src/services/finance-repository";

const ownerId = "11111111-1111-4111-8111-111111111111";

async function setup(
  destinationType: "cash" | "credit_card" = "cash",
  destinationCurrency = "THB",
  destinationOpening = "0.00"
) {
  const app = createApp({
    authVerifier: createStaticAuthVerifier({
      "owner-token": ownerId
    }),
    financeRepository: createMemoryFinanceRepository()
  });
  const workspaceResponse = await app.request("/v1/workspaces/private", {
    method: "POST",
    headers: {
      authorization: "Bearer owner-token",
      "content-type": "application/json"
    },
    body: JSON.stringify({ name: "การเงินของฉัน" })
  });
  const workspace = await workspaceResponse.json<{
    workspace: { id: string };
    categories: Array<{ id: string; slug: string }>;
  }>();

  async function createAccount(body: Record<string, unknown>) {
    const response = await app.request("/v1/accounts", {
      method: "POST",
      headers: {
        authorization: "Bearer owner-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        workspaceId: workspace.workspace.id,
        ...body
      })
    });
    return response.json<{ account: { id: string } }>();
  }

  const source = await createAccount({
    name: "เงินสด",
    type: "cash",
    currency: "THB",
    openingBalance: "1000.00"
  });
  const destination = await createAccount({
    name: destinationType === "credit_card" ? "บัตรเครดิต" : "บัญชีปลายทาง",
    type: destinationType,
    currency: destinationCurrency,
    openingBalance: destinationOpening
  });

  return {
    app,
    workspaceId: workspace.workspace.id,
    sourceAccountId: source.account.id,
    destinationAccountId: destination.account.id,
    feeCategoryId: workspace.categories.find(
      (category) => category.slug === "financial-fees"
    )!.id
  };
}

async function postTransfer(
  context: Awaited<ReturnType<typeof setup>>,
  overrides: Record<string, unknown> = {}
) {
  return context.app.request("/v1/transfers", {
    method: "POST",
    headers: {
      authorization: "Bearer owner-token",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      workspaceId: context.workspaceId,
      sourceAccountId: context.sourceAccountId,
      destinationAccountId: context.destinationAccountId,
      sourceAmount: "300.00",
      sourceCurrency: "THB",
      destinationAmount: "300.00",
      destinationCurrency: "THB",
      feeAmount: "0.00",
      financialDate: "2026-07-27",
      clientMutationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ...overrides
    })
  });
}

describe("POST /v1/transfers", () => {
  it("moves same-currency principal without income or expense", async () => {
    const context = await setup();
    const response = await postTransfer(context);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      state: "posted",
      reportEffect: {
        income: "0.00",
        expense: "0.00",
        cashFlow: "0.00"
      },
      accountBalances: expect.arrayContaining([
        expect.objectContaining({
          accountId: context.sourceAccountId,
          amount: "700.00"
        }),
        expect.objectContaining({
          accountId: context.destinationAccountId,
          amount: "300.00"
        })
      ])
    });
  });

  it("pays a credit card by reducing cash and liability", async () => {
    const context = await setup("credit_card", "THB", "500.00");
    const response = await postTransfer(context, {
      sourceAmount: "200.00",
      destinationAmount: "200.00"
    });

    await expect(response.json()).resolves.toMatchObject({
      accountBalances: expect.arrayContaining([
        expect.objectContaining({
          accountId: context.sourceAccountId,
          amount: "800.00"
        }),
        expect.objectContaining({
          accountId: context.destinationAccountId,
          amount: "300.00"
        })
      ])
    });
  });

  it("requires a positive exchange rate for cross-currency transfer", async () => {
    const context = await setup("cash", "USD");
    const invalid = await postTransfer(context, {
      sourceAmount: "350.00",
      destinationAmount: "10.00",
      destinationCurrency: "USD"
    });
    expect(invalid.status).toBe(400);

    const valid = await postTransfer(context, {
      sourceAmount: "350.00",
      destinationAmount: "10.00",
      destinationCurrency: "USD",
      exchangeRate: "0.0285714286",
      clientMutationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    });
    expect(valid.status).toBe(201);
    await expect(valid.json()).resolves.toMatchObject({
      accountBalances: expect.arrayContaining([
        expect.objectContaining({
          accountId: context.sourceAccountId,
          amount: "650.00"
        }),
        expect.objectContaining({
          accountId: context.destinationAccountId,
          amount: "10.00"
        })
      ])
    });
  });

  it("posts a fee once when the same mutation is retried", async () => {
    const context = await setup();
    const request = () =>
      postTransfer(context, {
        feeAmount: "10.00",
        feeCategoryId: context.feeCategoryId
      });

    const first = await request();
    const retry = await request();
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toMatchObject({
      reportEffect: {
        income: "0.00",
        expense: "10.00",
        cashFlow: "-10.00"
      },
      accountBalances: expect.arrayContaining([
        expect.objectContaining({
          accountId: context.sourceAccountId,
          amount: "690.00"
        }),
        expect.objectContaining({
          accountId: context.destinationAccountId,
          amount: "300.00"
        })
      ])
    });
  });
});
