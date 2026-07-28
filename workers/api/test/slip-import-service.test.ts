import { describe, expect, it, vi } from "vitest";

import { createSlipImportService } from "../src/services/slip-import-service";
import { SlipVisionUnavailableError } from
  "../src/services/slip-vision-extractor";

const userId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const accountId = "33333333-3333-4333-8333-333333333333";
const categoryId = "44444444-4444-4444-8444-444444444444";
const actor = { userId, accessToken: "token" };

function dependencies() {
  return {
    repository: {
      getQuota: vi.fn().mockResolvedValue({ used: 0, limit: 30 }),
      findDuplicate: vi.fn().mockResolvedValue(null),
      consumeQuota: vi.fn().mockResolvedValue({
        allowed: true,
        used: 1,
        limit: 30
      }),
      confirm: vi.fn(),
      confirmBatch: vi.fn()
    },
    financeRepository: {
      getSnapshot: vi.fn().mockResolvedValue({
        workspace: {
          id: workspaceId,
          baseCurrency: "THB"
        },
        accounts: [{
          id: accountId,
          name: "ธนาคารทดสอบ",
          institution: "ธนาคารทดสอบ",
          currency: "THB"
        }],
        categories: [{
          id: categoryId,
          name: "อาหาร",
          kind: "expense"
        }]
      })
    },
    extractor: {
      extract: vi.fn().mockResolvedValue({
        documentKind: "receipt",
        suggestedType: "expense",
        amount: "100.00",
        currency: "THB",
        financialDate: "2026-07-28",
        reference: "ABC",
        merchant: "ร้านอาหาร",
        sender: null,
        recipient: null,
        institution: null,
        confidence: {
          documentKind: 1,
          suggestedType: 1,
          amount: 1,
          financialDate: 1,
          reference: 1
        }
      })
    },
    tokenCodec: {
      issue: vi.fn().mockResolvedValue({
        token: "a".repeat(40),
        expiresAt: "2026-07-29T03:30:00.000Z"
      }),
      verify: vi.fn()
    }
  };
}

describe("SlipImportService", () => {
  it("returns a review draft and checks duplicates before inference", async () => {
    const deps = dependencies();
    const service = createSlipImportService(deps as never);
    const bytes = new Uint8Array([0xff, 0xd8, 0xff]);
    const result = await service.analyze(actor, {
      workspaceId,
      bytes,
      claimedMime: "image/jpeg",
      imageSha256:
        "6e568e1f67fba258184c78181539e5e8fdee447e49bb706fc0ea34fbf12336a5"
    });
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.analysisToken).toBe("a".repeat(40));
      expect(result.analysisExpiresAt).toBe("2026-07-29T03:30:00.000Z");
      expect(result.draft).toMatchObject({
        type: "expense",
        amount: "100.00",
        accountId,
        categoryId
      });
    }
    expect(deps.repository.findDuplicate).toHaveBeenCalledBefore(
      deps.extractor.extract
    );
  });

  it("does not consume quota or inference for duplicate image", async () => {
    const deps = dependencies();
    deps.repository.findDuplicate.mockResolvedValueOnce({
      id: "55555555-5555-4555-8555-555555555555",
      amount: "100.00",
      financialDate: "2026-07-28"
    });
    const service = createSlipImportService(deps as never);
    const result = await service.analyze(actor, {
      workspaceId,
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      claimedMime: "image/jpeg",
      imageSha256:
        "6e568e1f67fba258184c78181539e5e8fdee447e49bb706fc0ea34fbf12336a5"
    });
    expect(result.status).toBe("duplicate");
    expect(deps.repository.consumeQuota).not.toHaveBeenCalled();
    expect(deps.extractor.extract).not.toHaveBeenCalled();
  });

  it("preserves a bounded vision failure category for internal logging", async () => {
    const deps = dependencies();
    deps.extractor.extract.mockRejectedValueOnce(
      new SlipVisionUnavailableError("invalid_json")
    );
    const service = createSlipImportService(deps as never);

    await expect(service.analyze(actor, {
      workspaceId,
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      claimedMime: "image/jpeg",
      imageSha256:
        "6e568e1f67fba258184c78181539e5e8fdee447e49bb706fc0ea34fbf12336a5"
    })).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      logContext: { slipVisionCategory: "invalid_json" },
      status: 503
    });
  });

  it("returns the current workspace quota without consuming it", async () => {
    const deps = dependencies();
    deps.repository.getQuota.mockResolvedValue({
      used: 7,
      limit: 30
    });
    const service = createSlipImportService(deps as never);

    await expect(service.getQuota(actor, workspaceId)).resolves.toEqual({
      used: 7,
      limit: 30
    });
    expect(deps.repository.consumeQuota).not.toHaveBeenCalled();
  });

  it("verifies every token and sends one canonical token-free batch", async () => {
    const deps = dependencies();
    const firstItemId = "55555555-5555-4555-8555-555555555555";
    const secondItemId = "66666666-6666-4666-8666-666666666666";
    const firstTransaction = {
      workspaceId,
      accountId,
      type: "expense" as const,
      amount: "60.00",
      currency: "THB",
      financialDate: "2026-07-27",
      categoryId,
      tagIds: [],
      clientMutationId: "77777777-7777-4777-8777-777777777777"
    };
    const secondTransaction = {
      ...firstTransaction,
      amount: "1191.67",
      clientMutationId: "88888888-8888-4888-8888-888888888888"
    };
    deps.tokenCodec.verify
      .mockResolvedValueOnce({
        userId,
        workspaceId,
        imageSha256: "1".repeat(64),
        documentIdentitySha256: "a".repeat(64),
        documentKind: "bank_transfer",
        exp: 1_800_001_800
      })
      .mockResolvedValueOnce({
        userId,
        workspaceId,
        imageSha256: "2".repeat(64),
        documentIdentitySha256: "b".repeat(64),
        documentKind: "receipt",
        exp: 1_800_001_800
      });
    const posted = {
      status: "posted" as const,
      items: [{
        itemId: firstItemId,
        transaction: {
          transactionId: "99999999-9999-4999-8999-999999999999",
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
    deps.repository.confirmBatch.mockResolvedValue(posted);
    const service = createSlipImportService(deps as never);

    await expect(service.confirmBatch(actor, {
      workspaceId,
      batchMutationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      items: [{
        itemId: firstItemId,
        analysisToken: "x".repeat(40),
        transaction: firstTransaction
      }, {
        itemId: secondItemId,
        analysisToken: "y".repeat(40),
        transaction: secondTransaction
      }]
    })).resolves.toEqual(posted);

    expect(deps.tokenCodec.verify).toHaveBeenCalledTimes(2);
    expect(deps.repository.confirmBatch).toHaveBeenCalledWith(
      actor,
      {
        workspaceId,
        batchMutationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        requestSha256:
          "81c3da7109946f69eb646ee497716143c7afe7762e355cd41c177c82c0bdd4ff",
        items: [{
          itemId: firstItemId,
          imageSha256: "1".repeat(64),
          documentIdentitySha256: "a".repeat(64),
          documentKind: "bank_transfer",
          transaction: firstTransaction
        }, {
          itemId: secondItemId,
          imageSha256: "2".repeat(64),
          documentIdentitySha256: "b".repeat(64),
          documentKind: "receipt",
          transaction: secondTransaction
        }]
      }
    );
    expect(
      JSON.stringify(deps.repository.confirmBatch.mock.calls[0]![1])
    ).not.toContain("x".repeat(40));
  });

  it("returns bounded token issues only after checking every item", async () => {
    const deps = dependencies();
    deps.tokenCodec.verify
      .mockRejectedValueOnce(new Error("TOKEN_EXPIRED"))
      .mockRejectedValueOnce(new Error("TOKEN_SCOPE_INVALID"));
    const service = createSlipImportService(deps as never);
    const transaction = {
      workspaceId,
      accountId,
      type: "expense" as const,
      amount: "60.00",
      currency: "THB",
      financialDate: "2026-07-27",
      categoryId,
      tagIds: [],
      clientMutationId: "77777777-7777-4777-8777-777777777777"
    };

    await expect(service.confirmBatch(actor, {
      workspaceId,
      batchMutationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      items: [{
        itemId: "55555555-5555-4555-8555-555555555555",
        analysisToken: "x".repeat(40),
        transaction
      }, {
        itemId: "66666666-6666-4666-8666-666666666666",
        analysisToken: "y".repeat(40),
        transaction: {
          ...transaction,
          clientMutationId: "88888888-8888-4888-8888-888888888888"
        }
      }]
    })).resolves.toEqual({
      status: "blocked",
      issues: [{
        itemId: "55555555-5555-4555-8555-555555555555",
        code: "expired_analysis"
      }, {
        itemId: "66666666-6666-4666-8666-666666666666",
        code: "invalid_analysis"
      }]
    });
    expect(deps.tokenCodec.verify).toHaveBeenCalledTimes(2);
    expect(deps.repository.confirmBatch).not.toHaveBeenCalled();
  });

  it("blocks repeated image and document identities before persistence", async () => {
    const deps = dependencies();
    const baseClaims = {
      userId,
      workspaceId,
      imageSha256: "1".repeat(64),
      documentIdentitySha256: "a".repeat(64),
      documentKind: "receipt" as const,
      exp: 1_800_001_800
    };
    deps.tokenCodec.verify
      .mockResolvedValueOnce(baseClaims)
      .mockResolvedValueOnce(baseClaims);
    const service = createSlipImportService(deps as never);
    const transaction = {
      workspaceId,
      accountId,
      type: "expense" as const,
      amount: "60.00",
      currency: "THB",
      financialDate: "2026-07-27",
      categoryId,
      tagIds: [],
      clientMutationId: "77777777-7777-4777-8777-777777777777"
    };

    await expect(service.confirmBatch(actor, {
      workspaceId,
      batchMutationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      items: [{
        itemId: "55555555-5555-4555-8555-555555555555",
        analysisToken: "x".repeat(40),
        transaction
      }, {
        itemId: "66666666-6666-4666-8666-666666666666",
        analysisToken: "y".repeat(40),
        transaction: {
          ...transaction,
          clientMutationId: "88888888-8888-4888-8888-888888888888"
        }
      }]
    })).resolves.toEqual({
      status: "blocked",
      issues: [{
        itemId: "66666666-6666-4666-8666-666666666666",
        code: "duplicate"
      }]
    });
    expect(deps.repository.confirmBatch).not.toHaveBeenCalled();
  });
});
