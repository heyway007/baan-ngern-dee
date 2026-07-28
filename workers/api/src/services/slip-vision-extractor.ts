import type { SlipAiExtraction } from "@systems-credit/contracts";

import { normalizeSlipExtraction } from "./slip-extraction-normalizer";
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

export type SlipVisionFailureCategory =
  | "provider"
  | "empty_answer"
  | "invalid_json"
  | "invalid_shape";

export class SlipVisionUnavailableError extends Error {
  constructor(readonly category: SlipVisionFailureCategory) {
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

const question = `Extract only values visible in this Thai bank transfer slip or shop receipt.
Do not infer missing values; return null. For bank slips, choose income only when the
document clearly indicates money received. Amount is the final transfer or receipt
total, not balance, subtotal, tax, or change. Return Gregorian YYYY-MM-DD; subtract
543 only when a printed year is clearly Buddhist Era.
Thai labels such as "ชำระเงินสำเร็จ" or "จ่ายบิลสำเร็จ" mean an outgoing bank
payment and suggestedType expense. A two-digit Thai year is Buddhist Era.
Return null for a field you cannot read. Do not add fields.

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
      let providerResult: unknown;
      try {
        providerResult = await ai.run("@cf/moondream/moondream3.1-9B-A2B", {
          task: "query",
          image: `data:${input.mime};base64,${toBase64(input.bytes)}`,
          question,
          reasoning: false,
          stream: false,
          temperature: 0,
          max_tokens: 700
        });
      } catch {
        throw new SlipVisionUnavailableError("provider");
      }

      const result = providerResult as {
        answer?: unknown;
        result?: { answer?: unknown };
      } | null;
      const answer = result?.result?.answer ?? result?.answer;
      if (typeof answer !== "string" || !answer.trim()) {
        throw new SlipVisionUnavailableError("empty_answer");
      }

      let parsed: unknown;
      try {
        parsed = parseAnswer(answer);
      } catch {
        throw new SlipVisionUnavailableError("invalid_json");
      }

      try {
        return normalizeSlipExtraction(parsed);
      } catch {
        throw new SlipVisionUnavailableError("invalid_shape");
      }
    }
  };
}
