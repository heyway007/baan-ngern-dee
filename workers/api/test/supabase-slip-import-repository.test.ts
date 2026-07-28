import { describe, expect, it, vi } from "vitest";

import {
  createSupabaseSlipImportRepository
} from "../src/services/supabase-slip-import-repository";

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  accessToken: "user-jwt"
};
const workspaceId = "22222222-2222-4222-8222-222222222222";

describe("Supabase slip import repository", () => {
  it("reads quota through the dedicated RPC without consuming an attempt", async () => {
    const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ used: 7, limit: 30 })
    );
    const repository = createSupabaseSlipImportRepository({
      url: "https://project.supabase.co",
      anonKey: "anon-key",
      fetch: requestFetch
    });

    await expect(repository.getQuota(actor, workspaceId)).resolves.toEqual({
      used: 7,
      limit: 30
    });
    expect(requestFetch).toHaveBeenCalledWith(
      "https://project.supabase.co/rest/v1/rpc/get_slip_analysis_quota",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ p_workspace_id: workspaceId })
      })
    );
  });

  it("posts a canonical batch through one strict RPC call", async () => {
    const itemId = "33333333-3333-4333-8333-333333333333";
    const accountId = "44444444-4444-4444-8444-444444444444";
    const categoryId = "55555555-5555-4555-8555-555555555555";
    const command = {
      workspaceId,
      batchMutationId: "66666666-6666-4666-8666-666666666666",
      requestSha256: "f".repeat(64),
      items: [{
        itemId,
        imageSha256: "a".repeat(64),
        documentIdentitySha256: "b".repeat(64),
        documentKind: "receipt" as const,
        transaction: {
          workspaceId,
          accountId,
          categoryId,
          type: "expense" as const,
          amount: "60.00",
          currency: "THB",
          financialDate: "2026-07-27",
          tagIds: [],
          clientMutationId: "77777777-7777-4777-8777-777777777777"
        }
      }]
    };
    const posted = {
      status: "posted" as const,
      items: [{
        itemId,
        transaction: {
          transactionId: "88888888-8888-4888-8888-888888888888",
          version: 1,
          state: "posted" as const,
          accountBalances: [{
            accountId,
            amount: "-60.00",
            currency: "THB"
          }]
        }
      }]
    };
    const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(posted)
    );
    const repository = createSupabaseSlipImportRepository({
      url: "https://project.supabase.co",
      anonKey: "anon-key",
      fetch: requestFetch
    });

    await expect(repository.confirmBatch(actor, command)).resolves.toEqual(
      posted
    );
    expect(requestFetch).toHaveBeenCalledWith(
      "https://project.supabase.co/rest/v1/rpc/confirm_financial_document_import_batch",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ p_input: command })
      })
    );
  });

  it("rejects an unbounded batch issue returned by Supabase", async () => {
    const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        status: "blocked",
        issues: [{
          itemId: "33333333-3333-4333-8333-333333333333",
          code: "database_details"
        }]
      })
    );
    const repository = createSupabaseSlipImportRepository({
      url: "https://project.supabase.co",
      anonKey: "anon-key",
      fetch: requestFetch
    });

    await expect(repository.confirmBatch(actor, {
      workspaceId,
      batchMutationId: "66666666-6666-4666-8666-666666666666",
      requestSha256: "f".repeat(64),
      items: []
    })).rejects.toThrow();
  });
});
