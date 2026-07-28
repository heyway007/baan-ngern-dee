import { describe, expect, it, vi } from "vitest";

import {
  createCloudflareSlipVisionExtractor
} from "../src/services/slip-vision-extractor";

describe("Cloudflare slip vision extractor", () => {
  it("requests deterministic structured extraction", async () => {
    const run = vi.fn().mockResolvedValue({
      result: {
        answer: JSON.stringify({
          documentKind: "receipt",
          suggestedType: "expense",
          amount: "1,000.00",
          currency: "฿",
          financialDate: "2026-07-28",
          reference: "ABC",
          merchant: "ร้านทดสอบ",
          sender: null,
          recipient: null,
          institution: null
        }),
        caption: null,
        finish_reason: "stop",
        metrics: {
          decode_time_ms: 1,
          input_tokens: 100,
          output_tokens: 50,
          prefill_time_ms: 1,
          ttft_ms: 1
        },
        objects: null,
        points: null,
        reasoning: null
      },
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        prompt_tokens_details: { cached_tokens: 0 },
        neurons: 5
      }
    });
    const result = await createCloudflareSlipVisionExtractor({ run }).extract({
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      mime: "image/jpeg"
    });
    expect(result.amount).toBe("1000.00");
    expect(result.currency).toBe("THB");
    expect(result.confidence.amount).toBe(0.75);
    expect(run).toHaveBeenCalledWith(
      "@cf/moondream/moondream3.1-9B-A2B",
      expect.objectContaining({
        image: expect.stringMatching(/^data:image\/jpeg;base64,/),
        task: "query",
        reasoning: false,
        stream: false,
        temperature: 0,
        max_tokens: 700
      })
    );
  });

  it("normalizes a wrapped partial provider answer", async () => {
    const run = vi.fn().mockResolvedValue({
      result: {
        answer: JSON.stringify({
          documentKind: "bill_payment",
          suggestedType: "payment",
          amount: "60.00 บาท",
          financialDate: "27 ก.ค. 69",
          reference: "SYNTHETIC-060",
          recipient: "ร้านตัวอย่าง",
          institution: "ธนาคารตัวอย่าง"
        })
      }
    });
    const result = await createCloudflareSlipVisionExtractor({ run }).extract({
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      mime: "image/jpeg"
    });

    expect(result).toMatchObject({
      documentKind: "bank_transfer",
      suggestedType: "expense",
      amount: "60.00",
      currency: null,
      financialDate: "2026-07-27"
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("accepts a JSON answer wrapped in a Markdown code fence", async () => {
    const extractor = createCloudflareSlipVisionExtractor({
      run: vi.fn().mockResolvedValue({
        answer: `\`\`\`json
{"documentKind":"bank_transfer","suggestedType":"expense","amount":"250.00","currency":"THB","financialDate":"2026-07-28","reference":"REF-250","merchant":null,"sender":"A","recipient":"B","institution":"TEST BANK","confidence":{"documentKind":1,"suggestedType":0.8,"amount":1,"financialDate":1,"reference":1}}
\`\`\``
      })
    });

    const result = await extractor.extract({
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      mime: "image/jpeg"
    });

    expect(result.reference).toBe("REF-250");
  });

  it.each([
    [{}, "empty_answer"],
    [{ answer: "not-json" }, "invalid_json"],
    [{ answer: "[]" }, "invalid_shape"]
  ])("classifies unsafe provider output", async (providerResult, category) => {
    const extractor = createCloudflareSlipVisionExtractor({
      run: vi.fn().mockResolvedValue(providerResult)
    });

    await expect(extractor.extract({
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      mime: "image/jpeg"
    })).rejects.toMatchObject({ category });
  });

  it("classifies a rejected provider call", async () => {
    const extractor = createCloudflareSlipVisionExtractor({
      run: vi.fn().mockRejectedValue(new Error("provider detail"))
    });

    await expect(extractor.extract({
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      mime: "image/jpeg"
    })).rejects.toMatchObject({ category: "provider" });
  });
});
