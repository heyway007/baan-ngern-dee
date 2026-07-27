import { describe, expect, it, vi } from "vitest";
import { sumMoney } from "@systems-credit/domain";

import {
  createSupabaseAuthVerifier
} from "../src/services/supabase-client";
import {
  createSupabaseFinanceRepository
} from "../src/services/supabase-finance-repository";

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  accessToken: "user-jwt"
};

describe("Supabase Worker adapters", () => {
  it("verifies the caller JWT with Supabase Auth", async () => {
    const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ id: actor.userId })
    );
    const verifier = createSupabaseAuthVerifier({
      url: "https://project.supabase.co/",
      anonKey: "anon-key",
      fetch: requestFetch
    });

    await expect(verifier.verify(actor.accessToken)).resolves.toEqual({
      userId: actor.userId
    });
    const [url, init] = requestFetch.mock.calls[0]!;
    expect(url).toBe(
      "https://project.supabase.co/auth/v1/user"
    );
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer user-jwt"
    );
    expect(new Headers(init?.headers).get("apikey")).toBe("anon-key");
  });

  it("sends an exact generated schedule to the atomic RPC", async () => {
    const rpcResult = {
      contract: {
        id: "22222222-2222-4222-8222-222222222222",
        workspaceId: "33333333-3333-4333-8333-333333333333",
        name: "หนี้ทดสอบ",
        kind: "debt",
        originalPrincipal: "12000.00",
        downPayment: "0.00",
        financedPrincipal: "12000.00",
        financedFees: "0.00",
        currency: "THB",
        interestMethod: "flat",
        annualRate: "12",
        periods: 12,
        firstDueDate: "2026-08-01",
        status: "active",
        version: 1
      },
      schedule: []
    };
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ response: rpcResult, replayed: false })
      );
    const repository = createSupabaseFinanceRepository({
      url: "https://project.supabase.co",
      anonKey: "anon-key",
      fetch: requestFetch
    });

    await repository.createInstallmentContract(
      actor,
      {
        workspaceId:
          "33333333-3333-4333-8333-333333333333",
        name: "หนี้ทดสอบ",
        kind: "debt",
        originalPrincipal: "12000.00",
        downPayment: "0.00",
        financedFees: "0.00",
        currency: "THB",
        interestMethod: "flat",
        annualRate: "12",
        periods: 12,
        firstDueDate: "2026-08-01"
      },
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    );

    const [url, init] = requestFetch.mock.calls[0]!;
    expect(url).toBe(
      "https://project.supabase.co/rest/v1/rpc/create_installment_contract"
    );
    const body = JSON.parse(String(init?.body)) as {
      p_input: {
        financedPrincipal: string;
        clientMutationId: string;
        schedule: Array<{
          principal: string;
          interest: string;
          closingPrincipal: string;
        }>;
      };
    };
    expect(body.p_input.financedPrincipal).toBe("12000.00");
    expect(body.p_input.schedule).toHaveLength(12);
    expect(body.p_input.schedule.at(-1)?.closingPrincipal).toBe(
      "0.00"
    );
    expect(
      sumMoney(
        body.p_input.schedule.map((row) => ({
          amount: row.principal,
          currency: "THB"
        }))
      ).amount
    ).toBe("12000.00");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer user-jwt"
    );
  });

  it("returns a controlled authorization error when RLS hides a payoff contract", async () => {
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json([]));
    const repository = createSupabaseFinanceRepository({
      url: "https://project.supabase.co",
      anonKey: "anon-key",
      fetch: requestFetch
    });

    await expect(
      repository.postInstallmentPayoff(actor, {
        workspaceId:
          "33333333-3333-4333-8333-333333333333",
        contractId:
          "22222222-2222-4222-8222-222222222222",
        accountId:
          "44444444-4444-4444-8444-444444444444",
        action: "payoff",
        expectedRemainingPrincipal: "100.00",
        quotedInterest: "0.00",
        quotedFees: "0.00",
        currency: "THB",
        financialDate: "2026-08-01",
        clientMutationId:
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        expectedVersion: 1
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN_WORKSPACE",
      status: 403
    });
  });

  it("reaches the locked payoff replay when a concurrent request already closed the schedule", async () => {
    const payoffResponse = {
      payoffId: "55555555-5555-4555-8555-555555555555",
      action: "payoff",
      principalPayment: "100.00",
      interestDue: "0.00",
      feesDue: "0.00",
      reportableExpense: "0.00",
      totalCashRequired: "100.00",
      remainingPrincipal: "0.00",
      interestSaved: "0.00",
      contractStatus: "paid_off",
      contractVersion: 2,
      accountBalance: {
        accountId: "44444444-4444-4444-8444-444444444444",
        amount: "900.00",
        currency: "THB"
      }
    };
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(
        Response.json([
          {
            interest_method: "flat",
            annual_rate: "0",
            currency: "THB",
            version: 2
          }
        ])
      )
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(
        Response.json({
          response: payoffResponse,
          replayed: true
        })
      );
    const repository = createSupabaseFinanceRepository({
      url: "https://project.supabase.co",
      anonKey: "anon-key",
      fetch: requestFetch
    });

    await expect(
      repository.postInstallmentPayoff(actor, {
        workspaceId:
          "33333333-3333-4333-8333-333333333333",
        contractId:
          "22222222-2222-4222-8222-222222222222",
        accountId:
          "44444444-4444-4444-8444-444444444444",
        action: "payoff",
        expectedRemainingPrincipal: "100.00",
        quotedInterest: "0.00",
        quotedFees: "0.00",
        currency: "THB",
        financialDate: "2026-08-01",
        clientMutationId:
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        expectedVersion: 1
      })
    ).resolves.toEqual({
      response: payoffResponse,
      replayed: true
    });
    const rpcBody = JSON.parse(
      String(requestFetch.mock.calls[3]![1]?.body)
    ) as { p_input: Record<string, unknown> };
    expect(rpcBody.p_input).not.toHaveProperty("regeneratedRows");
    expect(rpcBody.p_input).not.toHaveProperty(
      "principalPayment"
    );
  });
});
