# Resilient Thai Slip Extraction Design

## Summary

Make the existing slip-import flow tolerate common variations in Workers AI
output instead of rejecting an otherwise readable slip because one field uses
an unexpected representation.

The first production examples in scope are two K+ slips that are valid JPEG
images and clearly show an amount, reference, parties, and a Thai short date
such as `27 ก.ค. 69`. Both currently reach the extraction layer but fail before
a reviewable draft is returned.

The fix keeps the existing privacy, duplicate-detection, quota, and explicit
confirmation behavior. It changes only how model output is interpreted before
the strict shared contract is applied.

## Goals

- Accept common Thai date, money, currency, and document-kind representations.
- Preserve every usable field when another extracted field is missing or
  malformed.
- Return a reviewable draft when meaningful financial data is available.
- Mark uncertain or missing fields for user review.
- Keep a strict validated contract at the boundary between extraction and the
  rest of the finance system.
- Record safe failure categories without logging images or extracted personal
  data.

## Non-goals

- Supporting HEIC, PDFs, statements, or multi-page documents.
- Posting a transaction without user confirmation.
- Persisting uploaded images or raw AI responses.
- Guaranteeing perfect OCR, account matching, or category selection.
- Adding a second AI call or a fallback model in this change.

## Data Flow

1. The browser continues to prepare one JPG, PNG, or WebP image and sends the
   exact prepared bytes to the authenticated Worker.
2. Duplicate-image and rate-limit checks run unchanged.
3. The Worker sends the image to the existing Moondream Workers AI model once.
4. The adapter parses a direct or wrapped JSON answer and removes an optional
   Markdown code fence.
5. A new normalization boundary converts recognized aliases and formats into a
   canonical candidate.
6. The strict `slipAiExtractionSchema` validates that canonical candidate.
7. The service builds a draft from valid fields and marks missing or uncertain
   fields for review.
8. The user edits and explicitly confirms the transaction through the existing
   confirmation path.

## Canonical Normalization

Normalization is deterministic application code, not another AI request.

### Document kind and transaction type

- Canonical document kinds remain `bank_transfer`, `receipt`, and
  `unsupported`.
- Bank-slip aliases such as `transfer`, `payment`, `bill_payment`,
  `ชำระเงิน`, and `จ่ายบิล` normalize to `bank_transfer`.
- Receipt aliases normalize to `receipt`.
- Unknown document-kind text becomes `bank_transfer` when a reference plus a
  bank, sender, or recipient is present. It becomes `receipt` when an amount
  plus a merchant is present. Otherwise it becomes `unsupported`.
- Type aliases normalize to `income` or `expense`.
- K+ text such as `ชำระเงินสำเร็จ` and `จ่ายบิลสำเร็จ` is an expense signal.
- An unknown type becomes `null`, never an extraction-wide failure.

### Money and currency

- Remove grouping commas, surrounding whitespace, `฿`, `บาท`, and `THB` from
  amount text.
- Preserve the exact decimal digits as a string and never convert through a
  JavaScript floating-point number.
- Parentheses, a leading minus sign, or unrelated text are not silently
  accepted as a positive transaction amount.
- Thai baht symbols and names normalize to `THB`.
- Unknown currency text becomes `null`, allowing the workspace base currency
  to be used by the existing draft builder.

### Thai dates

- Accept canonical `YYYY-MM-DD` unchanged after calendar validation.
- Accept numeric day/month/year order when the ordering is unambiguous.
- Accept Thai short and long month names, including dotted abbreviations such
  as `ก.ค.`.
- Convert four-digit Buddhist Era years by subtracting 543.
- Interpret a two-digit Thai slip year such as `69` as Buddhist Era 2569 and
  convert it to 2026.
- Reject impossible calendar dates instead of rolling them into another month.
- Missing or ambiguous dates become `null` and are marked for review.

### Text fields and confidence

- Missing optional text fields become `null`.
- Strings are Unicode-normalized, trimmed, and limited to the existing maximum
  length before strict validation.
- Extra model fields are discarded rather than causing strict-object failure.
- Confidence remains application-owned and conservative:
  - A normalized, present field receives `0.75`.
  - A missing or rejected field receives zero.
  - Model-provided confidence values are not trusted.

## Partial Results and Error Handling

A response becomes reviewable when it identifies a supported financial
document and contains either an amount plus one supporting date, reference, or
party field, or a reference plus a date and party field. This avoids accepting
an unrelated screenshot based on one hallucinated value.

- Missing amount or date does not discard the other fields.
- The draft builder flags missing required fields for review.
- Confirmation remains impossible until the normal transaction form has a
  valid positive amount, date, account, and category.
- A document with no meaningful financial fields returns `unsupported`.
- Provider failure, an empty answer, or an answer that cannot be parsed as an
  object returns the existing retryable AI error.

The Worker logs only a bounded failure category such as `provider`,
`empty_answer`, `invalid_json`, or `invalid_shape`, together with the request
ID. A valid but unsupported document is a normal response and is not logged as
an error. Logs never contain image bytes, raw answers, names, references,
account numbers, amounts, or dates.

## Privacy and Persistence

- Images remain in request memory only and are not stored.
- Raw and normalized extraction payloads are not persisted.
- The supplied real K+ images are diagnostic inputs only and are not added to
  Git.
- Automated fixtures use synthetic values and contain no real names, account
  numbers, QR data, or references.
- Duplicate hashes and the signed analysis token behave exactly as before.

## Testing Strategy

### Normalization unit tests

- Thai short date `27 ก.ค. 69` becomes `2026-07-27`.
- Four-digit Buddhist Era and canonical Gregorian dates normalize correctly.
- Impossible and ambiguous dates become `null`.
- `1,191.67 บาท` becomes amount `1191.67` and currency `THB`.
- Bank-payment and expense aliases become canonical enum values.
- Unknown optional fields become `null` and extra fields are discarded.
- One malformed field does not discard other valid fields.

### Adapter tests

- Direct and Cloudflare-wrapped answers are accepted.
- Fenced JSON is accepted.
- Missing optional keys produce a valid partial extraction.
- Invalid JSON and non-object answers produce a safe unavailable error.
- The model is called once with the prepared image.

### Service and web regression tests

- A partial extraction opens the review form with usable values.
- Missing amount or date is visibly marked for review.
- No transaction is created before explicit confirmation.
- Duplicate detection, quota handling, and manual entry continue to work.

### Release verification

- Run focused extractor, service, and web tests.
- Run the complete test suite, TypeScript typecheck, production build, and
  Worker dry run.
- Test both supplied K+ images against the deployed extraction path without
  confirming a transaction.
- Verify that each image produces a reviewable draft with the expected amount
  and date.

## Acceptance Criteria

- Both supplied K+ JPEG images produce a reviewable draft.
- The 1,191.67-baht slip yields amount `1191.67`.
- The 60-baht slip yields amount `60.00`.
- Both slips yield financial date `2026-07-27` and an expense suggestion.
- A malformed optional field no longer turns the entire analysis into
  `AI_UNAVAILABLE`.
- Missing or uncertain values are visibly reviewable and editable.
- Images and raw AI output are never persisted or logged.
- Existing duplicate prevention and explicit confirmation remain intact.
- All automated tests, type checking, and production builds pass.
