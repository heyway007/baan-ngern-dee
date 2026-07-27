import { toFinancialDate } from "@systems-credit/domain";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { createStaticAuthVerifier } from "../src/middleware/auth";
import { createMemoryFinanceRepository } from "../src/services/finance-repository";

const ownerId = "11111111-1111-4111-8111-111111111111";
const strangerId = "22222222-2222-4222-8222-222222222222";
const currentPeriod = toFinancialDate(
  new Date().toISOString(),
  "Asia/Bangkok"
).slice(0, 7);

type TestApp = ReturnType<typeof createApp>;

async function request(
  app: TestApp,
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH";
    body?: unknown;
    token?: "owner-token" | "stranger-token";
  } = {}
) {
  return app.request(path, {
    method: options.method ?? "POST",
    headers: {
      authorization: `Bearer ${options.token ?? "owner-token"}`,
      ...(options.body === undefined
        ? {}
        : { "content-type": "application/json" })
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) })
  });
}

async function setup() {
  const app = createApp({
    authVerifier: createStaticAuthVerifier({
      "owner-token": ownerId,
      "stranger-token": strangerId
    }),
    financeRepository: createMemoryFinanceRepository()
  });
  const workspaceResponse = await request(
    app,
    "/v1/workspaces/private",
    { body: { name: "การเงินของฉัน" } }
  );
  const workspace = await workspaceResponse.json<{
    workspace: { id: string };
    categories: Array<{ id: string; slug: string }>;
  }>();
  const accountResponse = await request(app, "/v1/accounts", {
    body: {
      workspaceId: workspace.workspace.id,
      name: "บัญชีเงินเดือน",
      type: "bank",
      currency: "THB",
      openingBalance: "1000.00"
    }
  });
  const account = await accountResponse.json<{
    account: { id: string };
  }>();

  return {
    app,
    workspaceId: workspace.workspace.id,
    accountId: account.account.id,
    salaryCategoryId: workspace.categories.find(
      ({ slug }) => slug === "salary"
    )!.id,
    housingCategoryId: workspace.categories.find(
      ({ slug }) => slug === "housing"
    )!.id
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

function templateBody(
  context: Setup,
  values: Record<string, unknown> = {}
) {
  return {
    workspaceId: context.workspaceId,
    name: "เงินเดือน",
    kind: "income",
    amount: "35000.00",
    currency: "THB",
    accountId: context.accountId,
    categoryId: context.salaryCategoryId,
    dayOfMonth: 25,
    startMonth: currentPeriod,
    ...values
  };
}

async function createTemplate(
  context: Setup,
  values: Record<string, unknown> = {}
) {
  const response = await request(
    context.app,
    "/v1/recurring-templates",
    { body: templateBody(context, values) }
  );
  expect(response.status).toBe(201);
  return response.json<{
    id: string;
    version: number;
    status: "active" | "paused" | "cancelled";
  }>();
}

async function materialize(context: Setup) {
  const response = await request(
    context.app,
    "/v1/recurring-periods/materialize",
    {
      body: {
        workspaceId: context.workspaceId,
        period: currentPeriod
      }
    }
  );
  expect(response.status).toBe(200);
  return response.json<{
    createdCount: number;
    existingCount: number;
  }>();
}

async function getPeriod(context: Setup) {
  const response = await request(
    context.app,
    `/v1/recurring-periods/${currentPeriod}?workspaceId=${context.workspaceId}`,
    { method: "GET" }
  );
  expect(response.status).toBe(200);
  return response.json<{
    period: string;
    occurrences: Array<{
      id: string;
      templateId: string;
      amount: string;
      scheduledDate: string;
      status: "pending" | "posted" | "skipped";
      version: number;
    }>;
  }>();
}

describe("recurring Worker routes", () => {
  it("materializes once, posts once, and skips only the selected month", async () => {
    const context = await setup();
    const salary = await createTemplate(context);
    const rent = await createTemplate(context, {
      name: "ค่าเช่า",
      kind: "expense",
      amount: "8000.00",
      categoryId: context.housingCategoryId,
      dayOfMonth: 1
    });

    expect(await materialize(context)).toEqual({
      createdCount: 2,
      existingCount: 0
    });
    expect(await materialize(context)).toEqual({
      createdCount: 0,
      existingCount: 2
    });

    const period = await getPeriod(context);
    const salaryOccurrence = period.occurrences.find(
      ({ templateId }) => templateId === salary.id
    )!;
    const rentOccurrence = period.occurrences.find(
      ({ templateId }) => templateId === rent.id
    )!;
    const clientMutationId = crypto.randomUUID();

    const postSalary = () =>
      request(
        context.app,
        `/v1/recurring-occurrences/${salaryOccurrence.id}/post`,
        {
          body: {
            version: salaryOccurrence.version,
            clientMutationId
          }
        }
      );
    const first = await postSalary();
    const firstBody = await first.json<{
      occurrence: { status: string };
      transaction: { transactionId: string };
    }>();
    const replay = await postSalary();

    expect(first.status).toBe(201);
    expect(firstBody.occurrence.status).toBe("posted");
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toEqual(firstBody);

    const duplicateMutation = await request(
      context.app,
      `/v1/recurring-occurrences/${rentOccurrence.id}/post`,
      {
        body: {
          version: rentOccurrence.version,
          clientMutationId
        }
      }
    );
    expect(duplicateMutation.status).toBe(409);
    await expect(duplicateMutation.json()).resolves.toMatchObject({
      error: { code: "DUPLICATE_MUTATION" }
    });

    const skipped = await request(
      context.app,
      `/v1/recurring-occurrences/${rentOccurrence.id}/skip`,
      { body: { version: rentOccurrence.version } }
    );
    expect(skipped.status).toBe(200);
    await expect(skipped.json()).resolves.toMatchObject({
      status: "skipped"
    });

    await request(
      context.app,
      `/v1/recurring-templates/${salary.id}`,
      {
        method: "PATCH",
        body: {
          ...templateBody(context, { amount: "36000.00" }),
          workspaceId: undefined,
          version: salary.version
        }
      }
    );
    await request(
      context.app,
      `/v1/recurring-templates/${rent.id}`,
      {
        method: "PATCH",
        body: {
          ...templateBody(context, {
            name: "ค่าเช่า",
            kind: "expense",
            amount: "9000.00",
            categoryId: context.housingCategoryId,
            dayOfMonth: 1
          }),
          workspaceId: undefined,
          version: rent.version
        }
      }
    );
    const immutableHistory = await getPeriod(context);
    expect(
      immutableHistory.occurrences.find(
        ({ templateId }) => templateId === salary.id
      )
    ).toMatchObject({ status: "posted", amount: "35000.00" });
    expect(
      immutableHistory.occurrences.find(
        ({ templateId }) => templateId === rent.id
      )
    ).toMatchObject({ status: "skipped", amount: "8000.00" });

    const snapshot = await request(context.app, "/v1/snapshot", {
      method: "GET"
    });
    await expect(snapshot.json()).resolves.toMatchObject({
      accountBalances: {
        [context.accountId]: { amount: "36000.00" }
      },
      transactions: [{ id: firstBody.transaction.transactionId }],
      recurringOccurrences: expect.arrayContaining([
        expect.objectContaining({ status: "posted" }),
        expect.objectContaining({ status: "skipped" })
      ])
    });
  });

  it("overwrites a current pending occurrence when its template is edited", async () => {
    const context = await setup();
    const template = await createTemplate(context, {
      name: "ค่าเช่า",
      kind: "expense",
      amount: "8000.00",
      categoryId: context.housingCategoryId,
      dayOfMonth: 1
    });
    await materialize(context);
    const occurrence = (await getPeriod(context)).occurrences[0]!;

    const editedOccurrence = await request(
      context.app,
      `/v1/recurring-occurrences/${occurrence.id}`,
      {
        method: "PATCH",
        body: {
          amount: "8250.75",
          scheduledDate: `${currentPeriod}-02`,
          version: occurrence.version
        }
      }
    );
    expect(editedOccurrence.status).toBe(200);

    const editedTemplate = await request(
      context.app,
      `/v1/recurring-templates/${template.id}`,
      {
        method: "PATCH",
        body: {
          ...templateBody(context, {
            name: "ค่าเช่าใหม่",
            kind: "expense",
            amount: "8100.00",
            categoryId: context.housingCategoryId,
            dayOfMonth: 3
          }),
          workspaceId: undefined,
          version: template.version
        }
      }
    );
    expect(editedTemplate.status).toBe(200);

    await expect(getPeriod(context)).resolves.toMatchObject({
      occurrences: [
        {
          amount: "8100.00",
          scheduledDate: `${currentPeriod}-03`,
          status: "pending",
          version: 3
        }
      ]
    });
  });

  it("rejects stale and cross-month occurrence edits", async () => {
    const context = await setup();
    await createTemplate(context);
    await materialize(context);
    const occurrence = (await getPeriod(context)).occurrences[0]!;
    const pastMaterialization = await request(
      context.app,
      "/v1/recurring-periods/materialize",
      {
        body: {
          workspaceId: context.workspaceId,
          period: "2000-01"
        }
      }
    );
    expect(pastMaterialization.status).toBe(400);

    const nextMonth = new Date(`${currentPeriod}-15T00:00:00.000Z`);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    const outsideDate = nextMonth.toISOString().slice(0, 10);

    const outside = await request(
      context.app,
      `/v1/recurring-occurrences/${occurrence.id}`,
      {
        method: "PATCH",
        body: {
          amount: "35000.00",
          scheduledDate: outsideDate,
          version: occurrence.version
        }
      }
    );
    expect(outside.status).toBe(400);

    const stale = await request(
      context.app,
      `/v1/recurring-occurrences/${occurrence.id}`,
      {
        method: "PATCH",
        body: {
          amount: "35000.00",
          scheduledDate: occurrence.scheduledDate,
          version: 99
        }
      }
    );
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      error: { code: "STALE_VERSION" }
    });
  });

  it("pauses, resumes, and permanently cancels without deleting the current occurrence", async () => {
    const context = await setup();
    const template = await createTemplate(context);
    const pause = await request(
      context.app,
      `/v1/recurring-templates/${template.id}/pause`,
      { body: { version: template.version } }
    );
    const paused = await pause.json<{ version: number }>();
    expect(await materialize(context)).toEqual({
      createdCount: 0,
      existingCount: 0
    });

    const resume = await request(
      context.app,
      `/v1/recurring-templates/${template.id}/resume`,
      { body: { version: paused.version } }
    );
    const resumed = await resume.json<{ version: number }>();
    expect(await materialize(context)).toEqual({
      createdCount: 1,
      existingCount: 0
    });
    const occurrence = (await getPeriod(context)).occurrences[0]!;

    const cancel = await request(
      context.app,
      `/v1/recurring-templates/${template.id}/cancel`,
      { body: { version: resumed.version } }
    );
    const cancelled = await cancel.json<{ version: number }>();
    expect((await getPeriod(context)).occurrences[0]!.status).toBe(
      "pending"
    );

    const forbiddenResume = await request(
      context.app,
      `/v1/recurring-templates/${template.id}/resume`,
      { body: { version: cancelled.version } }
    );
    expect(forbiddenResume.status).toBe(409);

    const skipped = await request(
      context.app,
      `/v1/recurring-occurrences/${occurrence.id}/skip`,
      { body: { version: occurrence.version } }
    );
    expect(skipped.status).toBe(200);
  });

  it("isolates workspaces and validates account, category, and currency", async () => {
    const context = await setup();
    const stranger = await request(
      context.app,
      "/v1/recurring-templates",
      {
        token: "stranger-token",
        body: templateBody(context)
      }
    );
    expect(stranger.status).toBe(403);

    const wrongCategory = await request(
      context.app,
      "/v1/recurring-templates",
      {
        body: templateBody(context, {
          categoryId: context.housingCategoryId
        })
      }
    );
    expect(wrongCategory.status).toBe(400);

    const wrongCurrency = await request(
      context.app,
      "/v1/recurring-templates",
      {
        body: templateBody(context, { currency: "USD" })
      }
    );
    expect(wrongCurrency.status).toBe(400);
  });
});
