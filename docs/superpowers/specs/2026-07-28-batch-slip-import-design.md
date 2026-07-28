# Batch Slip Import Design

Date: 2026-07-28

## Summary

Extend the existing private slip-import flow from one image at a time to a
reviewable queue of up to ten images. The browser analyzes each image through
the existing authenticated endpoint, presents all usable drafts in one
editable table, and posts the included rows through one atomic Supabase
operation.

The feature keeps the current privacy boundary: images exist only in browser
and Worker memory and are never persisted. Duplicate detection, signed
analysis claims, exact decimal money strings, workspace authorization, and
explicit user confirmation remain mandatory.

## Approved Decisions

- Select at most 10 images per batch.
- Use a desktop table that becomes cards on narrow screens.
- Analyze at most two images concurrently.
- Show duplicate rows and exclude them from posting.
- Let failed rows retry, replace their image, or leave the batch.
- Save every included valid row or save none.
- Remove the per-user hourly analysis limit.
- Keep a workspace-wide limit of 30 AI analysis attempts per UTC day.
- Keep account-owner matching out of this change; ambiguous transaction types
  remain review-required.

## Goals

- Make importing several Thai bank slips or receipts substantially faster than
  repeating the single-image dialog.
- Give every file an independent, understandable status.
- Preserve useful drafts when another image fails or is a duplicate.
- Require the user to resolve every uncertain field before posting.
- Make the final database write atomic and safely retryable.
- Avoid sudden Workers AI load by bounding the queue and its concurrency.

## Non-goals

- Persisting uploaded images.
- Supporting HEIC, PDF, statements, or multi-page documents.
- Automatically posting high-confidence rows before user confirmation.
- Matching sender or recipient names to account owners.
- Raising the batch above 10 images.
- Replacing the current Moondream extraction adapter or making a second AI call
  per image.

## User Experience

### Selection and queue

The gallery input accepts multiple JPG, PNG, or WebP files. Each original file
must be no larger than 5 MB, and one selection can contain at most 10 files.
The camera input remains single-image.

The browser prepares and fingerprints each image independently. A repeated hash
inside the current selection is marked as a local duplicate and is not
uploaded. Preparation errors remain attached to their own rows and do not stop
other files.

Each row has one of these states:

- `preparing`
- `queued`
- `analyzing`
- `ready`
- `needs_review`
- `duplicate`
- `unsupported`
- `failed`
- `quota_blocked`

The queue sends at most two analyze requests concurrently. Results appear as
soon as each request completes; source order remains stable.

### Review table

Desktop shows one table with file, status, type, amount, financial date,
account, category, and actions. Mobile renders the same data as stacked cards
without horizontal page overflow.

An edit action opens the existing transaction form for that row. Fields listed
in `fieldsNeedingReview` remain visibly highlighted. The batch summary shows:

- included and ready rows;
- rows requiring review;
- duplicates;
- failures;
- separate income and expense totals using exact decimal arithmetic.

The final action reads `บันทึกทั้งหมด N รายการ`. It is disabled while an
included row is processing, incomplete, invalid, or still requires review.
Duplicate, unsupported, failed, quota-blocked, and user-removed rows are not
included.

Closing a non-empty queue requires confirmation. Closing disposes every preview
URL and prepared blob.

## Browser Architecture

Split the current single-image dialog into focused units:

- `SlipBatchImportDialog` owns the queue, selection, concurrency, totals, and
  final confirmation.
- `SlipBatchQueue` renders stable ordered rows and their statuses.
- `SlipBatchRowEditor` adapts the existing `TransactionForm` behavior to edit a
  draft without posting it immediately.
- A pure queue reducer owns state transitions and prevents an old asynchronous
  result from overwriting a replaced or removed row.
- A bounded worker-pool helper runs no more than two analyses at once.

Every row has a browser-generated stable `itemId`, a unique transaction
`clientMutationId`, its prepared-image resource while needed, and, after a
successful analysis, an analysis token and editable transaction draft.

Removing or replacing a row aborts or ignores its stale analysis result and
disposes its image resources. The browser retains each prepared image in memory
until the row is removed or replaced, the batch posts, or the dialog closes.
This permits retry and token-expiry reanalysis without retaining an image on
the server or in browser storage.

## Analyze Data Flow

1. The user chooses 1–10 files.
2. The browser validates and prepares each image.
3. The browser computes SHA-256 and marks same-selection duplicates locally.
4. The bounded queue calls the existing `POST /v1/slip-imports/analyze`
   endpoint once per remaining image.
5. The Worker checks the persisted image hash before consuming quota.
6. Only a non-duplicate request consumes one daily attempt and calls Workers
   AI once.
7. The browser maps success, duplicate, unsupported, quota, and retryable
   failures onto the originating row.
8. The user edits all included drafts.

Extend a successful single-image analysis response with
`analysisExpiresAt: string` in ISO 8601 format. The browser uses this
server-issued timestamp for the batch expiry warning; it does not decode or
trust token claims itself.

The current analyze endpoint remains single-image. A multipart ten-image Worker
request is intentionally avoided because it increases request size, timeout
risk, and failure coupling.

## Quota

Create a new Supabase migration that replaces
`consume_slip_analysis_quota(uuid)`.

- Remove the rolling per-user hourly count.
- Retain the advisory lock for the workspace.
- Retain cleanup of attempts older than 24 hours.
- Allow at most 30 recorded AI attempts for one workspace in the current UTC
  day.
- Return bounded metadata: `allowed`, and when relevant `reason:
  "workspace_day"`, plus `used` and `limit`.
- Perform persisted duplicate detection before quota consumption.
- A request that reaches Workers AI counts even if the provider fails or the
  output is unreadable.

This is an application guard, not a Cloudflare platform limit. Cloudflare
currently provides 10,000 free Workers AI Neurons per account per UTC day:
https://developers.cloudflare.com/workers-ai/platform/pricing/

## Analysis Token Lifetime

Increase slip analysis claim validity from 15 minutes to 30 minutes so a user
can review ten rows. Tokens remain signed, user-scoped, workspace-scoped, and
bound to the image and document identity hashes.

The UI shows a batch expiry warning near the earliest included token. An
expired row cannot be confirmed and must be analyzed again. Extending the token
does not retain the image.

## Batch Confirmation Contract

Add:

`POST /v1/slip-imports/confirm-batch`

The strict request contains:

- `workspaceId`
- `batchMutationId`
- `items`, length 1–10
  - `itemId`
  - `clientMutationId`
  - `analysisToken`
  - reviewed `transaction`

Item IDs and mutation IDs must be unique within the request. Every transaction
must belong to the top-level workspace.

The Worker:

1. Validates the strict request contract.
2. Verifies every analysis token against the authenticated user and workspace.
3. Rejects repeated image hashes, document identities, and transaction mutation
   IDs inside the batch.
4. Builds canonical database inputs without passing raw tokens to Supabase.
5. Calls one batch repository operation.

The response is a discriminated union:

- `posted`: all posted transaction responses, keyed by `itemId`.
- `blocked`: no transaction posted, with bounded per-item issues such as
  `duplicate`, `invalid_account`, `invalid_category`, `currency_mismatch`,
  `expired_analysis`, or `mutation_conflict`.

Unexpected errors keep the existing safe API error contract and request ID.

## Atomic Supabase Operation

Add a Security Definer RPC dedicated to confirmed slip batches. It must:

- require the caller to be an owner or editor of the workspace;
- accept 1–10 canonical items;
- keep all inserts inside one PostgreSQL transaction;
- use the existing `post_transaction` financial source of truth;
- create one `financial_document_imports` row per posted transaction;
- treat any duplicate or business validation failure as a blocked whole batch;
- roll back all changes before returning blocked issues;
- never expose tables or helper functions directly to authenticated clients.

Add a private `financial_document_import_batches` table with:

- batch primary key;
- workspace and creator IDs;
- `batch_mutation_id`;
- canonical request SHA-256;
- expected item count;
- created timestamp;
- uniqueness on creator plus batch mutation ID.

Add batch and item identity columns to `financial_document_imports`, with one
unique item ID per batch. The Worker computes the canonical request hash after
token verification and sends it to the RPC.

Idempotency uses the batch row together with each transaction mutation ID. A
retry after a lost successful response with the same canonical hash rebuilds
and returns the same posted transaction responses by joining the batch imports
to their transactions. Reusing the batch mutation ID with another hash returns
`mutation_conflict`. A failed database transaction rolls back the batch row
too, so a corrected retry can post the complete batch.

No image, raw AI output, analysis token, party name, reference, amount, or date
is written to diagnostic logs.

## Error Handling

- Invalid file: keep the row with its local error; other rows continue.
- Local duplicate: mark duplicate without a network request.
- Persisted duplicate: show the existing transaction summary and exclude it.
- Unsupported document: exclude it and allow replacement or removal.
- Provider or malformed output: allow retry, replacement, or removal.
- Daily quota reached: stop starting queued analyses, preserve completed
  drafts, and mark untouched queued rows `quota_blocked`.
- Token expired: mark only the affected row and require re-analysis.
- Batch blocked: map bounded item issues to rows and keep all edits.
- Network uncertainty after confirmation: retry the identical mutations; never
  create a second transaction.

## Privacy and Security

- Prepared images and previews stay in browser memory only.
- Request image bytes stay in Worker memory only.
- Raw AI answers are not persisted or logged.
- Browser queue state is not written to local storage or IndexedDB.
- Analysis tokens are never sent back to Supabase in raw form.
- Synthetic fixtures replace real slip names, accounts, references, and QR
  content in automated tests.
- Confirmation remains an explicit user action.

## Testing

### Browser unit and component tests

- Reject an eleventh selected file.
- Preserve file order while two analyses complete out of order.
- Prove concurrency never exceeds two.
- Detect same-selection hashes before API calls.
- Continue after one prepare or analyze failure.
- Retry and replacement cannot accept stale asynchronous results.
- Dispose all preview URLs on replacement, removal, and close.
- Disable confirmation for unresolved included rows.
- Compute income and expense totals with exact decimal strings.
- Render table at desktop and cards at 820 px and 390 px.

### Contract and Worker tests

- Strictly parse 1–10 batch items and reject unknown keys.
- Reject duplicate item, mutation, image, or document identity values.
- Verify every token before calling the repository.
- Map quota metadata and bounded batch issues.
- Never return internal token claims or diagnostic context publicly.

### Database tests

- Remove the hourly limit and enforce the 30-attempt UTC-day workspace limit.
- Persisted duplicates do not consume quota.
- Ten valid confirmations commit together.
- One duplicate or invalid row rolls back every transaction and import row.
- A successful retry returns the same transaction IDs.
- A rolled-back retry can later post the full corrected batch.
- Cross-workspace and viewer attempts fail without data leakage.

### Release verification

- Run all focused and full tests, type checks, production build, and Worker dry
  run.
- Apply the new Supabase migration before deploying the Worker.
- Test 1, 2, and 10-file selections in production without using real personal
  data for repository fixtures.
- Confirm one controlled batch and verify snapshot balances exactly once.

## Acceptance Criteria

- A user can select up to ten supported images and see one stable row per file.
- No more than two Workers AI calls run concurrently.
- Duplicate and failed rows do not stop other analyses.
- No hourly application limit remains.
- The workspace cannot consume more than 30 AI attempts in one UTC day.
- Every included row is valid and review-complete before confirmation.
- The database posts every included item or none.
- Repeating an uncertain request cannot create duplicate transactions.
- Images and raw AI output are never persisted.
- Desktop and mobile layouts remain usable and accessible.
- Existing single-image camera flow and manual transaction entry continue to
  work.
