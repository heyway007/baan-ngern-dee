import { describe, expect, it, vi } from "vitest";

import type { CloudAuth, CloudSession } from "./cloud-auth";
import { createRemoteFinanceApi } from "./remote-finance-api";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
const categoryId = "33333333-3333-4333-8333-333333333333";
const contractId = "44444444-4444-4444-8444-444444444444";
const mutationId = "55555555-5555-4555-8555-555555555555";

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
  recurringOccurrences: []
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
    await api.createAccount({
      workspaceId,
      name: "Cash",
      type: "cash",
      currency: "THB",
      openingBalance: "0.00"
    });
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
});
