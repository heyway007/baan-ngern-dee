import {
  slipAiExtractionSchema,
  type SlipAiExtraction
} from "@systems-credit/contracts";

import type { SlipImageMime } from "./slip-image";

export interface SlipAiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface SlipVisionExtractor {
  extract(input: Readonly<{
    bytes: Uint8Array;
    mime: SlipImageMime;
  }>): Promise<SlipAiExtraction>;
}

export class SlipVisionUnavailableError extends Error {
  constructor() {
    super("SLIP_VISION_UNAVAILABLE");
    this.name = "SlipVisionUnavailableError";
  }
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const extractionJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    documentKind: {
      type: "string",
      enum: ["bank_transfer", "receipt", "unsupported"]
    },
    suggestedType: {
      anyOf: [
        { type: "string", enum: ["income", "expense"] },
        { type: "null" }
      ]
    },
    amount: { anyOf: [{ type: "string" }, { type: "null" }] },
    currency: { anyOf: [{ type: "string" }, { type: "null" }] },
    financialDate: { anyOf: [{ type: "string" }, { type: "null" }] },
    reference: { anyOf: [{ type: "string" }, { type: "null" }] },
    merchant: { anyOf: [{ type: "string" }, { type: "null" }] },
    sender: { anyOf: [{ type: "string" }, { type: "null" }] },
    recipient: { anyOf: [{ type: "string" }, { type: "null" }] },
    institution: { anyOf: [{ type: "string" }, { type: "null" }] },
    confidence: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        ["documentKind", "suggestedType", "amount", "financialDate", "reference"]
          .map((name) => [name, { type: "number", minimum: 0, maximum: 1 }])
      ),
      required: [
        "documentKind",
        "suggestedType",
        "amount",
        "financialDate",
        "reference"
      ]
    }
  },
  required: [
    "documentKind",
    "suggestedType",
    "amount",
    "currency",
    "financialDate",
    "reference",
    "merchant",
    "sender",
    "recipient",
    "institution",
    "confidence"
  ]
} as const;

const prompt = `Extract only values visible in this Thai bank transfer slip or shop receipt.
Do not infer missing values; return null. For bank slips, choose income only when the
document clearly indicates money received. Amount is the final transfer or receipt
total, not balance, subtotal, tax, or change. Return Gregorian YYYY-MM-DD; subtract
543 only when a printed year is clearly Buddhist Era.`;

export function createCloudflareSlipVisionExtractor(
  ai: SlipAiBinding
): SlipVisionExtractor {
  return {
    async extract(input) {
      try {
        const result = await ai.run(
          "@cf/meta/llama-3.2-11b-vision-instruct",
          {
            prompt,
            image: `data:${input.mime};base64,${toBase64(input.bytes)}`,
            temperature: 0,
            max_tokens: 700,
            response_format: {
              type: "json_schema",
              json_schema: extractionJsonSchema
            }
          }
        ) as { response?: unknown };
        const value =
          typeof result?.response === "string"
            ? JSON.parse(result.response)
            : result?.response;
        return slipAiExtractionSchema.parse(value);
      } catch {
        throw new SlipVisionUnavailableError();
      }
    }
  };
}
