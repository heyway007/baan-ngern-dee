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

function parseAnswer(answer: string) {
  const json = answer
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(json);
}

function addConservativeConfidence(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const fields = value as Record<string, unknown>;
  const present = (field: string) =>
    typeof fields[field] === "string" && fields[field].trim() ? 0.75 : 0;
  const amount = typeof fields.amount === "string"
    ? fields.amount.replace(/(?:THB|บาท|฿|,|\s)/gi, "")
    : fields.amount;
  const currency = typeof fields.currency === "string"
    ? fields.currency.trim().toUpperCase()
    : fields.currency;
  const normalizedCurrency =
    currency === "฿" || currency === "บาท" || currency === "BAHT"
      ? "THB"
      : typeof currency === "string" && /^[A-Z]{3}$/.test(currency)
        ? currency
        : null;
  return {
    ...fields,
    amount,
    currency: normalizedCurrency,
    confidence: {
      documentKind: present("documentKind"),
      suggestedType: present("suggestedType"),
      amount: present("amount"),
      financialDate: present("financialDate"),
      reference: present("reference")
    }
  };
}

const question = `Extract only values visible in this Thai bank transfer slip or shop receipt.
Do not infer missing values; return null. For bank slips, choose income only when the
document clearly indicates money received. Amount is the final transfer or receipt
total, not balance, subtotal, tax, or change. Return Gregorian YYYY-MM-DD; subtract
543 only when a printed year is clearly Buddhist Era.

Return only one valid JSON object without Markdown using exactly these fields:
{
  "documentKind": "bank_transfer" | "receipt" | "unsupported",
  "suggestedType": "income" | "expense" | null,
  "amount": string | null,
  "currency": string | null,
  "financialDate": string | null,
  "reference": string | null,
  "merchant": string | null,
  "sender": string | null,
  "recipient": string | null,
  "institution": string | null
}`;

export function createCloudflareSlipVisionExtractor(
  ai: SlipAiBinding
): SlipVisionExtractor {
  return {
    async extract(input) {
      try {
        const result = await ai.run("@cf/moondream/moondream3.1-9B-A2B", {
          task: "query",
          image: `data:${input.mime};base64,${toBase64(input.bytes)}`,
          question,
          reasoning: false,
          stream: false,
          temperature: 0,
          max_tokens: 700
        }) as {
          answer?: unknown;
          result?: { answer?: unknown };
        };
        const answer = result?.result?.answer ?? result?.answer;
        const value =
          typeof answer === "string"
            ? parseAnswer(answer)
            : answer;
        return slipAiExtractionSchema.parse(addConservativeConfidence(value));
      } catch {
        throw new SlipVisionUnavailableError();
      }
    }
  };
}
