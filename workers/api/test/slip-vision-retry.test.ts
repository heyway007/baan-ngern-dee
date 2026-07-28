import { describe, expect, it, vi } from "vitest";

import type { SlipAiExtraction } from "@systems-credit/contracts";

import {
  extractSlipWithRetry
} from "../src/services/slip-vision-retry";
import {
  SlipVisionUnavailableError,
  type SlipVisionExtractor
} from "../src/services/slip-vision-extractor";

const image = {
  bytes: new Uint8Array([0xff, 0xd8, 0xff]),
  mime: "image/jpeg" as const
};
const extraction: SlipAiExtraction = {
  documentKind: "bank_transfer",
  suggestedType: "expense",
  amount: "60.00",
  currency: "THB",
  financialDate: "2026-07-27",
  reference: "REF-60",
  merchant: "ร้านทดสอบ",
  sender: "ผู้ส่ง",
  recipient: "ผู้รับ",
  institution: "ธนาคารทดสอบ",
  confidence: {
    documentKind: 1,
    suggestedType: 1,
    amount: 1,
    financialDate: 1,
    reference: 1
  }
};

function extractor(
  extract: SlipVisionExtractor["extract"]
): SlipVisionExtractor {
  return { extract };
}

describe("slip vision retry", () => {
  it("returns a first-attempt result without sleeping or logging", async () => {
    const sleep = vi.fn();
    const log = vi.fn();

    await expect(extractSlipWithRetry({
      extractor: extractor(vi.fn().mockResolvedValue(extraction)),
      input: image,
      requestId: "request-first",
      sleep,
      log
    })).resolves.toEqual(extraction);

    expect(sleep).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("waits 300 ms after a provider failure and succeeds next", async () => {
    const extract = vi.fn()
      .mockRejectedValueOnce(
        new SlipVisionUnavailableError("provider")
      )
      .mockResolvedValueOnce(extraction);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();

    await expect(extractSlipWithRetry({
      extractor: extractor(extract),
      input: image,
      requestId: "request-provider",
      sleep,
      log
    })).resolves.toEqual(extraction);

    expect(extract).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(300);
    expect(log).toHaveBeenCalledWith({
      code: "SLIP_VISION_RETRY",
      attempt: 1,
      maxAttempts: 3,
      slipVisionCategory: "provider",
      requestId: "request-provider",
      path: "/v1/slip-imports/analyze"
    });
  });

  it("waits 300 and 900 ms before a third-attempt success", async () => {
    const extract = vi.fn()
      .mockRejectedValueOnce(
        new SlipVisionUnavailableError("invalid_json")
      )
      .mockRejectedValueOnce(
        new SlipVisionUnavailableError("invalid_json")
      )
      .mockResolvedValueOnce(extraction);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(extractSlipWithRetry({
      extractor: extractor(extract),
      input: image,
      requestId: "request-json",
      sleep,
      log: vi.fn()
    })).resolves.toEqual(extraction);

    expect(extract).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[300], [900]]);
  });

  it("stops after three bounded failures", async () => {
    const failure = new SlipVisionUnavailableError("empty_answer");
    const extract = vi.fn().mockRejectedValue(failure);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();

    await expect(extractSlipWithRetry({
      extractor: extractor(extract),
      input: image,
      requestId: "request-empty",
      sleep,
      log
    })).rejects.toBe(failure);

    expect(extract).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[300], [900]]);
    expect(log).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenLastCalledWith({
      code: "SLIP_VISION_RETRY",
      attempt: 3,
      maxAttempts: 3,
      slipVisionCategory: "empty_answer",
      requestId: "request-empty",
      path: "/v1/slip-imports/analyze"
    });
  });

  it("does not retry an unexpected programming error", async () => {
    const failure = new Error("unexpected");
    const extract = vi.fn().mockRejectedValue(failure);
    const sleep = vi.fn();
    const log = vi.fn();

    await expect(extractSlipWithRetry({
      extractor: extractor(extract),
      input: image,
      requestId: "request-error",
      sleep,
      log
    })).rejects.toBe(failure);

    expect(extract).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
