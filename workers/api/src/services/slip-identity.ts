import type { SlipAiExtraction } from "@systems-credit/contracts";

import { sha256Hex } from "./slip-image";

function normalize(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("th-TH")
    .replace(/[\s\-_/.:]+/g, "");
}

export async function buildDocumentIdentity(
  extraction: SlipAiExtraction
): Promise<string | null> {
  const issuer = extraction.institution ?? extraction.merchant;
  if (
    !issuer ||
    !extraction.reference ||
    !extraction.financialDate ||
    !extraction.amount ||
    !extraction.currency ||
    extraction.confidence.reference < 0.7 ||
    extraction.confidence.amount < 0.7 ||
    extraction.confidence.financialDate < 0.7
  ) {
    return null;
  }
  return sha256Hex([
    extraction.documentKind,
    normalize(issuer),
    normalize(extraction.reference),
    extraction.financialDate,
    extraction.currency,
    extraction.amount
  ].join("|"));
}
