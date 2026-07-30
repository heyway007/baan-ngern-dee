import { describe, expect, it, vi } from "vitest";

import type { CloudAuth, CloudSession } from "./cloud-auth";
import { createRemoteFinanceApi } from "./remote-finance-api";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
const categoryId = "33333333-3333-4333-8333-333333333333";
const contractId = "44444444-4444-4444-8444-444444444444";
const mutationId = "55555555-5555-4555-8555-555555555555";
const templateId = "77777777-7777-4777-8777-777777777777";
const occurrenceId = "88888888-8888-4888-8888-888888888888";
const allocationId = "99999999-9999-4999-8999-999999999999";
const goalId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const session: CloudSession = {
  userId: "66666666-6666-4666-8666-666666666666",
  email: "min@example.test",
  displayName: "มิน",
  accessToken: "access-token"
};

const emptySnapshot = {
  version: 1,
  workspace: null,
  categories: [],
  accounts: [],
  accountBalances: {},
  openingTransactions: [],
  transactions: [],
  installmentContracts: [],
  installmentSchedules: {},
  installmentPayments: [],
  installmentPayoffs: [],
  recurringTemplates: [],
  recurringOccurrences: [],
  budgetAllocations: [],
  savingsGoals: []
} as const;

function createAuth(): CloudAuth {
  return {
    getSession: vi.fn().mockResolvedValue(session),
    refreshSession: vi.fn().mockResolvedValue({
      ...session,
      accessToken: "refreshed-token"
    }),
    subscribe: vi.fn(() => () => undefined),
    signIn: vi.fn(),
    signUp: vi.fn(),
    requestPasswordReset: vi.fn(),
    startLineSignIn: vi.fn(),
    updatePassword: vi.fn(),
    signOut: vi.fn()
  };
}

describe("createRemoteFinanceApi", () => {
  it("sends the current bearer token and validates the snapshot", async () => {
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(emptySnapshot));
    const api = createRemoteFinanceApi({
      auth: createAuth(),
      fetch: requestFetch,
      onUnauthenticated: vi.fn()
    });

    await expect(api.getSnapshot()).resolves.toEqual(emptySnapshot);
    const [url, init] = requestFetch.mock.calls[0]!;
    expect(url).toBe("/v1/snapshot");
    expect(init?.method).toBe("GET");
    expect(
      new Headers(init?.headers).get("authorization")
    ).toBe("Bearer access-token");
  });

  it("refreshes once after 401 and retries with the new token", async () => {
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: "UNAUTHENTICATED",
              message: "expired",
              requestId: "request-1"
            }
          },
          { status: 401 }
        )
      )
      .mockResolvedValueOnce(Response.json(emptySnapshot));
    const auth = createAuth();
    const api = createRemoteFinanceApi({
      auth,
      fetch: requestFetch,
      onUnauthenticated: vi.fn()
    });

    await expect(api.getSnapshot()).resolves.toEqual(emptySnapshot);
    expect(auth.refreshSession).toHaveBeenCalledOnce();
    expect(
      new Headers(requestFetch.mock.calls[1]![1]?.headers).get(
        "authorization"
      )
    ).toBe("Bearer refreshed-token");
  });

  it("stops after the second 401 and reports the signed-out state", async () => {
    const unauthorized = () =>
      Response.json(
        {
          error: {
            code: "UNAUTHENTICATED",
            message: "expired",
            requestId: "request-1"
          }
        },
        { status: 401 }
      );
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(unauthorized());
    const onUnauthenticated = vi.fn();
    const api = createRemoteFinanceApi({
      auth: createAuth(),
      fetch: requestFetch,
      onUnauthenticated
    });

    await expect(api.getSnapshot()).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      status: 401
    });
    expect(requestFetch).toHaveBeenCalledTimes(2);
    expect(onUnauthenticated).toHaveBeenCalledOnce();
  });

  it("maps workspace, account, category, and transaction mutations", async () => {
    const workspaceResult = {
      workspace: {
        id: workspaceId,
        name: "Owner workspace",
        kind: "private",
        baseCurrency: "THB",
        timeZone: "Asia/Bangkok",
        role: "owner",
        version: 1
      },
      categories: []
    };
    const accountResult = {
      account: {
        id: accountId,
        workspaceId,
        name: "Cash",
        type: "cash",
        currency: "THB",
        institution: null,
        version: 1
      },
      accountBalance: {
        accountId,
        amount: "0.00",
        currency: "THB"
      }
    };
    const category = {
      id: categoryId,
      workspaceId,
      slug: "custom-test",
      name: "Test",
      kind: "expense",
      isDefault: false,
      version: 1
    };
    const transactionResult = {
      transactionId: mutationId,
      version: 1,
      state: "posted",
      accountBalances: [
        { accountId, amount: "-10.00", currency: "THB" }
      ]
    };
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(workspaceResult))
      .mockResolvedValueOnce(Response.json(accountResult))
      .mockResolvedValueOnce(Response.json({ category }))
      .mockResolvedValueOnce(Response.json(transactionResult));
    const api = createRemoteFinanceApi({
      auth: createAuth(),
      fetch: requestFetch,
      onUnauthenticated: vi.fn()
    });

    await api.createPrivateWorkspace({
      name: "Owner workspace",
      baseCurrency: "THB",
      timeZone: "Asia/Bangkok"
    });
    await expect(api.createAccount({
      workspaceId,
      name: "Cash",
      type: "cash",
      currency: "THB",
      openingBalance: "0.00"
    })).resolves.toMatchObject({ account: { id: accountId } });
    await expect(
      api.createCategory({
        workspaceId,
        name: "Test",
        kind: "expense"
      })
    ).resolves.toEqual(category);
    await api.postTransaction({
      workspaceId,
      accountId,
      type: "expense",
      amount: "10.00",
      currency: "THB",
      financialDate: "2026-07-27",
      categoryId,
      tagIds: [],
      clientMutationId: mutationId
    });

    expect(
      requestFetch.mock.calls.map(([url, init]) => [
        url,
        init?.method,
        JSON.parse(String(init?.body))
      ])
    ).toEqual([
      [
        "/v1/workspaces/private",
        "POST",
        {
          name: "Owner workspace",
          baseCurrency: "THB",
          timeZone: "Asia/Bangkok"
        }
      ],
      [
        "/v1/accounts",
        "POST",
        {
          workspaceId,
          name: "Cash",
          type: "cash",
          currency: "THB",
          openingBalance: "0.00"
        }
      ],
      [
        "/v1/categories",
        "POST",
        { workspaceId, name: "Test", kind: "expense" }
      ],
      [
        "/v1/transactions",
        "POST",
        {
          workspaceId,
          accountId,
          type: "expense",
          amount: "10.00",
          currency: "THB",
          financialDate: "2026-07-27",
          categoryId,
          tagIds: [],
          clientMutationId: mutationId
        }
      ]
    ]);
  });

  it("sends slip analysis as authenticated multipart data", async () => {
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ status: "unsupported" }));
    const api = createRemoteFinanceApi({
      auth: createAuth(),
      fetch: requestFetch,
      onUnauthenticated: vi.fn()
    });
    await expect(api.analyzeSlip({
      workspaceId,
      clientMutationId: mutationId,
      imageSha256: "a".repeat(64),
      image: new Blob([new Uint8Array([0xff, 0xd8, 0xff])], {
        type: "image/jpeg"
      })
    })).resolves.toEqual({ status: "unsupported" });
    const [, init] = requestFetch.mock.calls[0]!;
    expect(init?.body).toBeInstanceOf(FormData);
    expect(new Headers(init?.headers).has("content-type")).toBe(false);
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer access-token"
    );
  });

  it("reads the current slip quota without consuming it", async () => {
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ used: 7, limit: 30 }));
    const api = createRemoteFinanceApi({
      auth: createAuth(),
      fetch: requestFetch,
      onUnauthenticated: vi.fn()
    });

    await expect(api.getSlipQuota(workspaceId)).resolves.toEqual({
      used: 7,
      limit: 30
    });
    expect(requestFetch).toHaveBeenCalledWith(
      `/v1/slip-imports/quota?workspaceId=${encodeURIComponent(workspaceId)}`,
      expect.objectContaining({ method: "GET" })
    );
  });

  it("confirms and strictly validates a slip batch", async () => {
    const itemId = "99999999-9999-4999-8999-999999999999";
    const input = {
      workspaceId,
      batchMutationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      items: [{
        itemId,
        analysisToken: "a".repeat(40),
        transaction: {
          workspaceId,
          accountId,
          categoryId,
          type: "expense" as const,
          amount: "60.00",
          currency: "THB",
          financialDate: "2026-07-27",
          tagIds: [],
          clientMutationId: mutationId
        }
      }]
    };
    const posted = {
      status: "posted",
      items: [{
        itemId,
        transaction: {
          transactionId: occurrenceId,
          version: 1,
          state: "posted",
          accountBalances: [{
            accountId,
            amount: "-60.00",
            currency: "THB"
          }]
        }
      }]
    };
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(posted))
      .mockResolvedValueOnce(Response.json({
        status: "blocked",
        issues: [{ itemId, code: "database_details" }]
      }));
    const api = createRemoteFinanceApi({
      auth: createAuth(),
      fetch: requestFetch,
      onUnauthenticated: vi.fn()
    });

    await expect(api.confirmSlipBatch(input)).resolves.toEqual(posted);
    const [url, init] = requestFetch.mock.calls[0]!;
    expect(url).toBe("/v1/slip-imports/confirm-batch");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(input);
    await expect(api.confirmSlipBatch(input)).rejects.toThrow();
  });

  it("voids a transaction with its current version and reason", async () => {
    const response = {
      transactionId: mutationId,
      version: 2,
      state: "void",
      accountBalances: [
        { accountId, amount: "1000.00", currency: "THB" }
      ]
    } as const;
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(response));
    const api = createRemoteFinanceApi({
      auth: createAuth(),
      fetch: requestFetch,
      onUnauthenticated: vi.fn()
    });

    await expect(
      api.voidTransaction(mutationId, {
        version: 1,
        reason: "บันทึกรายการผิด"
      })
    ).resolves.toEqual(response);

    expect(requestFetch).toHaveBeenCalledOnce();
    const [url, init] = requestFetch.mock.calls[0]!;
    expect(url).toBe(`/v1/transactions/${mutationId}/void`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      version: 1,
      reason: "บันทึกรายการผิด"
    });
  });

  it("maps installment creation, payment, and payoff with the cached version", async () => {
    const snapshot = {
      ...emptySnapshot,
      installmentContracts: [
        {
          id: contractId,
          workspaceId,
          name: "Debt",
          kind: "debt",
          originalPrincipal: "100.00",
          downPayment: "0.00",
          financedPrincipal: "100.00",
          financedFees: "0.00",
          currency: "THB",
          interestMethod: "zero",
          annualRate: "0",
          periods: 1,
          firstDueDate: "2026-08-27",
          status: "active",
          version: 3
        }
      ]
    };
    const contractResult = {
      contract: {
        ...snapshot.installmentContracts[0],
        version: 1
      },
      schedule: []
    };
    const paymentResult = {
      paymentId: mutationId,
      allocation: {
        penalty: "0.00",
        fees: "0.00",
        interest: "0.00",
        principal: "10.00",
        total: "10.00"
      },
      reportableExpense: "0.00",
      scheduleStatus: "partially_paid",
      contractStatus: "active",
      contractVersion: 4,
      accountBalance: {
        accountId,
        amount: "90.00",
        currency: "THB"
      }
    };
    const payoffResult = {
      payoffId: mutationId,
      action: "payoff",
      principalPayment: "90.00",
      interestDue: "0.00",
      feesDue: "0.00",
      reportableExpense: "0.00",
      totalCashRequired: "90.00",
      remainingPrincipal: "0.00",
      interestSaved: "0.00",
      contractStatus: "paid_off",
      contractVersion: 4,
      accountBalance: {
        accountId,
        amount: "0.00",
        currency: "THB"
      }
    };
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(snapshot))
      .mockResolvedValueOnce(Response.json(contractResult))
      .mockResolvedValueOnce(Response.json(paymentResult))
      .mockResolvedValueOnce(Response.json(payoffResult));
    const api = createRemoteFinanceApi({
      auth: createAuth(),
      fetch: requestFetch,
      onUnauthenticated: vi.fn()
    });
    await api.getSnapshot();
    await api.createInstallmentContract(
      {
        workspaceId,
        name: "Debt",
        kind: "debt",
        originalPrincipal: "100.00",
        downPayment: "0.00",
        financedFees: "0.00",
        currency: "THB",
        interestMethod: "zero",
        annualRate: "0",
        periods: 1,
        firstDueDate: "2026-08-27"
      },
      mutationId
    );
    await api.postInstallmentPayment({
      workspaceId,
      contractId,
      sequence: 1,
      accountId,
      amount: "10.00",
      penaltyAmount: "0.00",
      currency: "THB",
      financialDate: "2026-08-27",
      clientMutationId: mutationId
    });
    await api.postInstallmentPayoff({
      workspaceId,
      contractId,
      accountId,
      action: "payoff",
      expectedRemainingPrincipal: "90.00",
      quotedInterest: "0.00",
      quotedFees: "0.00",
      currency: "THB",
      financialDate: "2026-08-28",
      clientMutationId: mutationId
    });

    expect(JSON.parse(String(requestFetch.mock.calls[1]![1]?.body)))
      .toMatchObject({ clientMutationId: mutationId });
    expect(JSON.parse(String(requestFetch.mock.calls[2]![1]?.body)))
      .toMatchObject({ expectedVersion: 3 });
    expect(JSON.parse(String(requestFetch.mock.calls[3]![1]?.body)))
      .toMatchObject({ expectedVersion: 3 });
    expect(requestFetch.mock.calls[2]![0]).toBe(
      `/v1/installments/${contractId}/payments`
    );
    expect(requestFetch.mock.calls[3]![0]).toBe(
      `/v1/installments/${contractId}/payoff`
    );
  });

  it("maps every recurring template and occurrence operation", async () => {
    const templateInput = {
      workspaceId,
      name: "ค่าเช่า",
      kind: "expense" as const,
      amount: "8000.00",
      currency: "THB",
      accountId,
      categoryId,
      dayOfMonth: 1,
      startMonth: "2026-07"
    };
    const template = {
      id: templateId,
      ...templateInput,
      status: "active" as const,
      version: 1
    };
    const updatedTemplate = {
      ...template,
      amount: "8250.00",
      version: 2
    };
    const occurrence = {
      id: occurrenceId,
      workspaceId,
      templateId,
      name: "ค่าเช่า",
      kind: "expense" as const,
      period: "2026-07",
      scheduledDate: "2026-07-01",
      amount: "8250.00",
      currency: "THB",
      accountId,
      categoryId,
      status: "pending" as const,
      version: 2
    };
    const postedOccurrence = {
      ...occurrence,
      status: "posted" as const,
      transactionId: mutationId,
      version: 3
    };
    const postedResult = {
      occurrence: postedOccurrence,
      transaction: {
        transactionId: mutationId,
        version: 1,
        state: "posted" as const,
        accountBalances: [
          {
            accountId,
            amount: "-8250.00",
            currency: "THB"
          }
        ]
      }
    };
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(template))
      .mockResolvedValueOnce(Response.json(updatedTemplate))
      .mockResolvedValueOnce(
        Response.json({ ...updatedTemplate, status: "paused", version: 3 })
      )
      .mockResolvedValueOnce(
        Response.json({ ...updatedTemplate, status: "active", version: 4 })
      )
      .mockResolvedValueOnce(
        Response.json({ ...updatedTemplate, status: "cancelled", version: 5 })
      )
      .mockResolvedValueOnce(
        Response.json({ createdCount: 1, existingCount: 0 })
      )
      .mockResolvedValueOnce(
        Response.json({ period: "2026-07", occurrences: [occurrence] })
      )
      .mockResolvedValueOnce(Response.json(occurrence))
      .mockResolvedValueOnce(
        Response.json({ ...occurrence, status: "skipped", version: 3 })
      )
      .mockResolvedValueOnce(Response.json(postedResult));
    const api = createRemoteFinanceApi({
      auth: createAuth(),
      fetch: requestFetch,
      onUnauthenticated: vi.fn()
    });

    await expect(api.createRecurringTemplate(templateInput)).resolves.toEqual(
      template
    );
    await api.updateRecurringTemplate(templateId, {
      ...templateInput,
      amount: "8250.00",
      version: 1
    });
    await api.pauseRecurringTemplate(templateId, { version: 2 });
    await api.resumeRecurringTemplate(templateId, { version: 3 });
    await api.cancelRecurringTemplate(templateId, { version: 4 });
    await api.materializeRecurringPeriod({
      workspaceId,
      period: "2026-07"
    });
    await expect(
      api.getRecurringPeriod(workspaceId, "2026-07")
    ).resolves.toEqual({
      period: "2026-07",
      occurrences: [occurrence]
    });
    await api.updateRecurringOccurrence(occurrenceId, {
      amount: "8250.00",
      scheduledDate: "2026-07-01",
      version: 1
    });
    await api.skipRecurringOccurrence(occurrenceId, { version: 2 });
    await expect(
      api.postRecurringOccurrence(occurrenceId, {
        version: 2,
        clientMutationId: mutationId
      })
    ).resolves.toEqual(postedResult);

    expect(
      requestFetch.mock.calls.map(([url, init]) => [
        url,
        init?.method,
        init?.body ? JSON.parse(String(init.body)) : undefined
      ])
    ).toEqual([
      ["/v1/recurring-templates", "POST", templateInput],
      [
        `/v1/recurring-templates/${templateId}`,
        "PATCH",
        { ...templateInput, amount: "8250.00", version: 1 }
      ],
      [
        `/v1/recurring-templates/${templateId}/pause`,
        "POST",
        { version: 2 }
      ],
      [
        `/v1/recurring-templates/${templateId}/resume`,
        "POST",
        { version: 3 }
      ],
      [
        `/v1/recurring-templates/${templateId}/cancel`,
        "POST",
        { version: 4 }
      ],
      [
        "/v1/recurring-periods/materialize",
        "POST",
        { workspaceId, period: "2026-07" }
      ],
      [
        `/v1/recurring-periods/2026-07?workspaceId=${workspaceId}`,
        "GET",
        undefined
      ],
      [
        `/v1/recurring-occurrences/${occurrenceId}`,
        "PATCH",
        {
          amount: "8250.00",
          scheduledDate: "2026-07-01",
          version: 1
        }
      ],
      [
        `/v1/recurring-occurrences/${occurrenceId}/skip`,
        "POST",
        { version: 2 }
      ],
      [
        `/v1/recurring-occurrences/${occurrenceId}/post`,
        "POST",
        { version: 2, clientMutationId: mutationId }
      ]
    ]);
  });

  it("loads and mutates the financial plan through the planning routes", async () => {
    const plan = {
      workspaceId,
      month: "2026-07",
      currency: "THB",
      totals: {
        baseBudget: "10000.00",
        priorCarry: "500.00",
        available: "10500.00",
        spent: "2000.00",
        remaining: "8500.00"
      },
      categories: [
        {
          categoryId,
          categoryName: "อาหาร",
          allocationId,
          allocationVersion: 1,
          isBudgeted: true,
          baseBudget: "10000.00",
          priorCarry: "500.00",
          available: "10500.00",
          spent: "2000.00",
          remaining: "8500.00"
        }
      ],
      goals: [
        {
          id: goalId,
          name: "เงินสำรอง",
          accountId,
          accountName: "เงินออม",
          currentAmount: "25000.00",
          targetAmount: "100000.00",
          currency: "THB",
          targetDate: "2027-07-01",
          percent: 25,
          reached: false,
          accountArchived: false,
          status: "active",
          version: 1
        }
      ]
    } as const;
    const allocation = {
      id: allocationId,
      workspaceId,
      categoryId,
      month: "2026-07",
      amount: "10000.00",
      version: 1
    } as const;
    const goal = {
      id: goalId,
      workspaceId,
      name: "เงินสำรอง",
      targetAmount: "100000.00",
      currency: "THB",
      targetDate: "2027-07-01",
      accountId,
      accountType: "bank",
      status: "active",
      version: 1
    } as const;
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(plan))
      .mockResolvedValueOnce(Response.json({ createdCount: 2 }))
      .mockResolvedValueOnce(Response.json(allocation))
      .mockResolvedValueOnce(
        Response.json({
          ...allocation,
          removedAt: "2026-07-29T10:00:00Z",
          version: 2
        })
      )
      .mockResolvedValueOnce(Response.json(goal))
      .mockResolvedValueOnce(
        Response.json({ ...goal, name: "ฉุกเฉิน", version: 2 })
      )
      .mockResolvedValueOnce(
        Response.json({ ...goal, status: "archived", version: 2 })
      );
    const api = createRemoteFinanceApi({
      auth: createAuth(),
      fetch: requestFetch,
      onUnauthenticated: vi.fn()
    });

    await expect(
      api.getFinancialPlan(workspaceId, "2026-07")
    ).resolves.toEqual(plan);
    await api.initializeBudgetMonth({ workspaceId, month: "2026-07" });
    await api.setMonthlyBudget({
      workspaceId,
      categoryId,
      month: "2026-07",
      amount: "10000.00"
    });
    await api.removeMonthlyBudget(allocationId, { version: 1 });
    await api.createSavingsGoal({
      workspaceId,
      name: "เงินสำรอง",
      targetAmount: "100000.00",
      currency: "THB",
      targetDate: "2027-07-01",
      accountId
    });
    await api.updateSavingsGoal(goalId, {
      name: "ฉุกเฉิน",
      targetAmount: "100000.00",
      currency: "THB",
      targetDate: "2027-07-01",
      accountId,
      version: 1
    });
    await api.archiveSavingsGoal(goalId, { version: 2 });

    expect(
      requestFetch.mock.calls.map(([url, init]) => [
        url,
        init?.method,
        init?.body ? JSON.parse(String(init.body)) : undefined
      ])
    ).toEqual([
      [
        `/v1/planning/2026-07?workspaceId=${workspaceId}`,
        "GET",
        undefined
      ],
      [
        "/v1/planning/budgets/initialize",
        "POST",
        { workspaceId, month: "2026-07" }
      ],
      [
        "/v1/planning/budgets",
        "POST",
        {
          workspaceId,
          categoryId,
          month: "2026-07",
          amount: "10000.00"
        }
      ],
      [
        `/v1/planning/budgets/${allocationId}/remove`,
        "POST",
        { version: 1 }
      ],
      [
        "/v1/planning/goals",
        "POST",
        {
          workspaceId,
          name: "เงินสำรอง",
          targetAmount: "100000.00",
          currency: "THB",
          targetDate: "2027-07-01",
          accountId
        }
      ],
      [
        `/v1/planning/goals/${goalId}`,
        "PATCH",
        {
          name: "ฉุกเฉิน",
          targetAmount: "100000.00",
          currency: "THB",
          targetDate: "2027-07-01",
          accountId,
          version: 1
        }
      ],
      [
        `/v1/planning/goals/${goalId}/archive`,
        "POST",
        { version: 2 }
      ]
    ]);
  });
});
