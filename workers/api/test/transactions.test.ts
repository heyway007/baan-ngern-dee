import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { createStaticAuthVerifier } from "../src/middleware/auth";
import { createMemoryFinanceRepository } from "../src/services/finance-repository";

const ownerId = "11111111-1111-4111-8111-111111111111";

async function setup(accountType: "cash" | "credit_card" = "cash") {
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
  const workspaceBody = await workspaceResponse.json<{
    workspace: { id: string };
    categories: Array<{ id: string; slug: string }>;
  }>();
  const accountResponse = await app.request("/v1/accounts", {
    method: "POST",
    headers: {
      authorization: "Bearer owner-token",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      workspaceId: workspaceBody.workspace.id,
      name: accountType === "cash" ? "เงินสด" : "บัตรเครดิต",
      type: accountType,
      currency: "THB",
      openingBalance: accountType === "cash" ? "1000.00" : "0.00"
    })
  });
  const accountBody = await accountResponse.json<{
    account: { id: string };
  }>();
  return {
    app,
    workspaceId: workspaceBody.workspace.id,
    accountId: accountBody.account.id,
    foodCategoryId: workspaceBody.categories.find(
      (category) => category.slug === "food"
    )!.id
  };
}

function transactionBody(
  input: Awaited<ReturnType<typeof setup>>,
  overrides: Record<string, unknown> = {}
) {
  return {
    workspaceId: input.workspaceId,
    accountId: input.accountId,
    type: "expense",
    amount: "125.50",
    currency: "THB",
    financialDate: "2026-07-27",
    categoryId: input.foodCategoryId,
    clientMutationId: crypto.randomUUID(),
    ...overrides
  };
}

async function post(
  app: Awaited<ReturnType<typeof setup>>["app"],
  path: string,
  body: unknown
) {
  return app.request(path, {
    method: "POST",
    headers: {
      authorization: "Bearer owner-token",
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

describe("POST /v1/transactions", () => {
  it("posts a cash expense and returns the authoritative balance", async () => {
    const context = await setup();
    const response = await post(
      context.app,
      "/v1/transactions",
      transactionBody(context)
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      state: "posted",
      version: 1,
      accountBalances: [
        {
          accountId: context.accountId,
          amount: "874.50",
          currency: "THB"
        }
      ]
    });
  });

  it("posts a card expense as a liability increase", async () => {
    const context = await setup("credit_card");
    const response = await post(
      context.app,
      "/v1/transactions",
      transactionBody(context, { amount: "100.00" })
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      accountBalances: [
        {
          accountId: context.accountId,
          amount: "100.00",
          currency: "THB"
        }
      ]
    });
  });

  it("rejects mismatched splits without changing the balance", async () => {
    const context = await setup();
    const invalid = await post(
      context.app,
      "/v1/transactions",
      transactionBody(context, {
        amount: "100.00",
        categoryId: undefined,
        splits: [
          { categoryId: context.foodCategoryId, amount: "60.00" },
          { categoryId: context.foodCategoryId, amount: "39.99" }
        ]
      })
    );
    expect(invalid.status).toBe(400);

    const valid = await post(
      context.app,
      "/v1/transactions",
      transactionBody(context, { amount: "100.00" })
    );
    await expect(valid.json()).resolves.toMatchObject({
      accountBalances: [{ amount: "900.00" }]
    });
  });

  it("requires the current version before voiding and reverses once", async () => {
    const context = await setup();
    const posted = await post(
      context.app,
      "/v1/transactions",
      transactionBody(context, { amount: "100.00" })
    );
    const postedBody = await posted.json<{ transactionId: string }>();

    const stale = await post(
      context.app,
      `/v1/transactions/${postedBody.transactionId}/void`,
      { version: 9, reason: "ทดสอบ version เก่า" }
    );
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      error: { code: "STALE_VERSION" }
    });

    const voided = await post(
      context.app,
      `/v1/transactions/${postedBody.transactionId}/void`,
      { version: 1, reason: "บันทึกผิดรายการ" }
    );
    expect(voided.status).toBe(200);
    await expect(voided.json()).resolves.toMatchObject({
      state: "void",
      version: 2,
      accountBalances: [{ amount: "1000.00" }]
    });
  });
});
