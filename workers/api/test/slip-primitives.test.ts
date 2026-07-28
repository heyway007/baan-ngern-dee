import { describe, expect, it } from "vitest";

import {
  sha256Hex,
  validateSlipImage
} from "../src/services/slip-image";
import { buildDocumentIdentity } from "../src/services/slip-identity";
import { createSlipAnalysisTokenCodec } from "../src/services/slip-analysis-token";

describe("slip primitives", () => {
  it("validates image bytes and computes SHA-256", async () => {
    expect(validateSlipImage(
      new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
      "image/jpeg"
    ).mime).toBe("image/jpeg");
    expect(() => validateSlipImage(
      new Uint8Array([0xff, 0xd8, 0xff]),
      "image/png"
    )).toThrow("MIME_MISMATCH");
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it("normalizes canonical document identity", async () => {
    const base = {
      documentKind: "receipt" as const,
      suggestedType: "expense" as const,
      amount: "100.00",
      currency: "THB",
      financialDate: "2026-07-28",
      reference: "AB-123",
      merchant: "ร้าน ทดสอบ",
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
    };
    expect(await buildDocumentIdentity(base)).toBe(
      await buildDocumentIdentity({
        ...base,
        reference: "ab 123",
        merchant: "ร้านทดสอบ"
      })
    );
  });

  it("signs, scopes, and expires analysis tokens", async () => {
    const now = 1_000_000;
    const codec = createSlipAnalysisTokenCodec("x".repeat(32), () => now);
    const token = await codec.issue({
      userId: "11111111-1111-4111-8111-111111111111",
      workspaceId: "22222222-2222-4222-8222-222222222222",
      imageSha256: "a".repeat(64),
      documentIdentitySha256: null,
      documentKind: "receipt"
    });
    await expect(codec.verify(token, {
      userId: "11111111-1111-4111-8111-111111111111",
      workspaceId: "22222222-2222-4222-8222-222222222222"
    })).resolves.toMatchObject({ exp: now + 900 });
    const expired = createSlipAnalysisTokenCodec(
      "x".repeat(32),
      () => now + 901
    );
    await expect(expired.verify(token, {
      userId: "11111111-1111-4111-8111-111111111111",
      workspaceId: "22222222-2222-4222-8222-222222222222"
    })).rejects.toThrow("TOKEN_EXPIRED");
  });
});
