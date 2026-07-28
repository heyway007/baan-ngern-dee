import { describe, expect, it, vi } from "vitest";

import {
  createCloudflareSlipVisionExtractor,
  SlipVisionUnavailableError
} from "../src/services/slip-vision-extractor";

describe("Cloudflare slip vision extractor", () => {
  it("requests deterministic structured extraction", async () => {
    const run = vi.fn().mockResolvedValue({
      response: {
        documentKind: "receipt",
        suggestedType: "expense",
        amount: "100.00",
        currency: "THB",
        financialDate: "2026-07-28",
        reference: "ABC",
        merchant: "ร้านทดสอบ",
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
      }
    });
    const result = await createCloudflareSlipVisionExtractor({ run }).extract({
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      mime: "image/jpeg"
    });
    expect(result.amount).toBe("100.00");
    expect(run).toHaveBeenCalledWith(
      "@cf/meta/llama-3.2-11b-vision-instruct",
      expect.objectContaining({
        image: expect.stringMatching(/^data:image\/jpeg;base64,/),
        temperature: 0,
        max_tokens: 700,
        response_format: expect.objectContaining({ type: "json_schema" })
      })
    );
  });

  it("converts malformed provider output to a safe error", async () => {
    const extractor = createCloudflareSlipVisionExtractor({
      run: vi.fn().mockResolvedValue({ response: "not-json" })
    });
    await expect(extractor.extract({
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      mime: "image/jpeg"
    })).rejects.toBeInstanceOf(SlipVisionUnavailableError);
  });
});
