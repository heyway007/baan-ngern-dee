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
      confirm: vi.fn()
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
});
