import { describe, expect, it } from "vitest";

import { normalizeSlipExtraction } from
  "../src/services/slip-extraction-normalizer";

describe("normalizeSlipExtraction", () => {
  it("normalizes a K+ bill payment with a Thai short date", () => {
    expect(normalizeSlipExtraction({
      documentKind: "bill_payment",
      suggestedType: "payment",
      amount: "1,191.67 บาท",
      currency: "฿",
      financialDate: "27 ก.ค. 69",
      reference: "SYNTHETIC-001",
      merchant: null,
      sender: "ผู้ชำระตัวอย่าง",
      recipient: "บัตรตัวอย่าง",
      institution: "ธนาคารตัวอย่าง",
      ignoredProviderField: "discard me"
    })).toEqual({
      documentKind: "bank_transfer",
      suggestedType: "expense",
      amount: "1191.67",
      currency: "THB",
      financialDate: "2026-07-27",
      reference: "SYNTHETIC-001",
      merchant: null,
      sender: "ผู้ชําระตัวอย่าง",
      recipient: "บัตรตัวอย่าง",
      institution: "ธนาคารตัวอย่าง",
      confidence: {
        documentKind: 0.75,
        suggestedType: 0.75,
        amount: 0.75,
        financialDate: 0.75,
        reference: 0.75
      }
    });
  });

  it.each([
    ["2026-07-27", "2026-07-27"],
    ["27/07/2569", "2026-07-27"],
    ["27 กรกฎาคม 2569", "2026-07-27"],
    ["31 ก.พ. 69", null],
    ["not-a-date", null]
  ])("normalizes date %s", (financialDate, expected) => {
    const result = normalizeSlipExtraction({
      documentKind: "receipt",
      suggestedType: "expense",
      amount: "60.00",
      currency: "THB",
      financialDate,
      reference: "SYNTHETIC-DATE",
      merchant: "ร้านตัวอย่าง"
    });

    expect(result.financialDate).toBe(expected);
  });

  it("keeps usable fields when optional values are malformed", () => {
    const result = normalizeSlipExtraction({
      documentKind: "transfer",
      suggestedType: "outgoing",
      amount: "60.00 THB",
      currency: "บาท",
      financialDate: "bad date",
      reference: 42,
      recipient: "ผู้รับตัวอย่าง",
      institution: "ธนาคารตัวอย่าง"
    });

    expect(result).toMatchObject({
      documentKind: "bank_transfer",
      suggestedType: "expense",
      amount: "60.00",
      currency: "THB",
      financialDate: null,
      reference: null,
      recipient: "ผู้รับตัวอย่าง"
    });
    expect(result.confidence.financialDate).toBe(0);
    expect(result.confidence.reference).toBe(0);
  });

  it("returns unsupported for an object without enough financial evidence", () => {
    expect(normalizeSlipExtraction({
      documentKind: "screen",
      amount: "543.00"
    }).documentKind).toBe("unsupported");
  });

  it("rejects non-object provider output", () => {
    expect(() => normalizeSlipExtraction([])).toThrowError(
      expect.objectContaining({ category: "invalid_shape" })
    );
  });
});
