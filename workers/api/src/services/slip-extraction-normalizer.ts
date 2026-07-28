import {
  slipAiExtractionSchema,
  type SlipAiExtraction
} from "@systems-credit/contracts";

export class SlipExtractionNormalizationError extends Error {
  readonly category = "invalid_shape" as const;

  constructor() {
    super("SLIP_EXTRACTION_INVALID_SHAPE");
    this.name = "SlipExtractionNormalizationError";
  }
}

const expenseAliases = new Set([
  "expense",
  "payment",
  "outgoing",
  "paid",
  "รายจ่าย",
  "ชำระเงิน",
  "จ่ายเงิน",
  "จ่ายบิล",
  "ชำระเงินสำเร็จ",
  "จ่ายบิลสำเร็จ"
]);
const incomeAliases = new Set([
  "income",
  "incoming",
  "received",
  "receive",
  "รายรับ",
  "รับเงิน",
  "เงินเข้า"
]);
const bankAliases = new Set([
  "bank_transfer",
  "transfer",
  "payment",
  "bill_payment",
  "ชำระเงิน",
  "จ่ายเงิน",
  "จ่ายบิล",
  "โอนเงิน",
  "ชำระเงินสำเร็จ",
  "จ่ายบิลสำเร็จ"
]);
const receiptAliases = new Set([
  "receipt",
  "shop_receipt",
  "ใบเสร็จ",
  "ใบกำกับภาษี"
]);

const thaiMonths = new Map([
  ["มค", 1], ["มกราคม", 1],
  ["กพ", 2], ["กุมภาพันธ์", 2],
  ["มีค", 3], ["มีนาคม", 3],
  ["เมย", 4], ["เมษายน", 4],
  ["พค", 5], ["พฤษภาคม", 5],
  ["มิย", 6], ["มิถุนายน", 6],
  ["กค", 7], ["กรกฎาคม", 7],
  ["สค", 8], ["สิงหาคม", 8],
  ["กย", 9], ["กันยายน", 9],
  ["ตค", 10], ["ตุลาคม", 10],
  ["พย", 11], ["พฤศจิกายน", 11],
  ["ธค", 12], ["ธันวาคม", 12]
]);

function thaiDigits(value: string) {
  return value.replace(/[๐-๙]/g, (digit) =>
    String("๐๑๒๓๔๕๖๗๘๙".indexOf(digit))
  );
}

function aliasKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim().toLocaleLowerCase();
  return normalized ? normalized.replace(/\s+/g, " ") : null;
}

function optionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim();
  return normalized ? normalized.slice(0, 200) : null;
}

function normalizeAmount(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = thaiDigits(value)
    .normalize("NFKC")
    .replace(/(?:THB|บาท|฿|,|\s)/gi, "");
  return /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(cleaned) &&
    /[1-9]/.test(cleaned)
    ? cleaned
    : null;
}

function normalizeCurrency(value: unknown): string | null {
  const normalized = aliasKey(value);
  if (!normalized) return null;
  if (normalized === "฿" || normalized === "บาท" || normalized === "baht") {
    return "THB";
  }
  return /^[a-z]{3}$/.test(normalized)
    ? normalized.toUpperCase()
    : null;
}

function gregorianYear(year: number, sourceDigits: number) {
  if (sourceDigits === 2) return 2500 + year - 543;
  return year >= 2400 ? year - 543 : year;
}

function validDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = thaiDigits(value).normalize("NFKC").trim();

  const canonical = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (canonical) {
    return validDate(
      Number(canonical[1]),
      Number(canonical[2]),
      Number(canonical[3])
    );
  }

  const numeric = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(normalized);
  if (numeric) {
    return validDate(
      gregorianYear(Number(numeric[3]), numeric[3].length),
      Number(numeric[2]),
      Number(numeric[1])
    );
  }

  const textual = /^(\d{1,2})\s+([ก-๙.]+)\s+(\d{2}|\d{4})$/.exec(
    normalized
  );
  if (!textual) return null;
  const month = thaiMonths.get(textual[2].replace(/[.\s]/g, ""));
  if (!month) return null;
  return validDate(
    gregorianYear(Number(textual[3]), textual[3].length),
    month,
    Number(textual[1])
  );
}

function normalizeSuggestedType(value: unknown): "income" | "expense" | null {
  const normalized = aliasKey(value);
  if (!normalized) return null;
  if (expenseAliases.has(normalized)) return "expense";
  if (incomeAliases.has(normalized)) return "income";
  return null;
}

function declaredDocumentKind(
  value: unknown
): "bank_transfer" | "receipt" | null {
  const normalized = aliasKey(value);
  if (!normalized) return null;
  if (bankAliases.has(normalized)) return "bank_transfer";
  if (receiptAliases.has(normalized)) return "receipt";
  return null;
}

export function normalizeSlipExtraction(value: unknown): SlipAiExtraction {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SlipExtractionNormalizationError();
  }

  const fields = value as Record<string, unknown>;
  const amount = normalizeAmount(fields.amount);
  const currency = normalizeCurrency(fields.currency);
  const financialDate = normalizeDate(fields.financialDate);
  const reference = optionalText(fields.reference);
  const merchant = optionalText(fields.merchant);
  const sender = optionalText(fields.sender);
  const recipient = optionalText(fields.recipient);
  const institution = optionalText(fields.institution);
  const suggestedType = normalizeSuggestedType(fields.suggestedType);
  const partyPresent = Boolean(merchant || sender || recipient || institution);
  const reviewable =
    Boolean(amount && (financialDate || reference || partyPresent)) ||
    Boolean(reference && financialDate && partyPresent);

  const declaredKind = declaredDocumentKind(fields.documentKind);
  const inferredKind =
    reference && (institution || sender || recipient)
      ? "bank_transfer"
      : amount && merchant
        ? "receipt"
        : "unsupported";
  const documentKind = reviewable
    ? (declaredKind ?? inferredKind)
    : "unsupported";

  return slipAiExtractionSchema.parse({
    documentKind,
    suggestedType,
    amount,
    currency,
    financialDate,
    reference,
    merchant,
    sender,
    recipient,
    institution,
    confidence: {
      documentKind: declaredKind ? 0.75 : 0,
      suggestedType: suggestedType ? 0.75 : 0,
      amount: amount ? 0.75 : 0,
      financialDate: financialDate ? 0.75 : 0,
      reference: reference ? 0.75 : 0
    }
  });
}
