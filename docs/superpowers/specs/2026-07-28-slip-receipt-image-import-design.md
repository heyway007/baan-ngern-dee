# Slip and Receipt Image Import Design

## Summary

Add an authenticated image-import flow to the transaction page. A user can
upload or photograph a Thai bank transfer slip or a shop receipt, have
Cloudflare Workers AI extract structured financial data, review the populated
transaction form, and explicitly confirm the transaction.

The first release supports:

- Thai bank transfer slips for both incoming and outgoing transfers.
- Shop receipts.
- JPG, PNG, and WebP images up to 5 MB after client-side preparation.
- Duplicate prevention using both an image fingerprint and a canonical
  document identity.
- Transient image processing. The application never persists the original or
  prepared image.

The feature does not create a transaction automatically. AI output is a draft
that the user must review and confirm.

## Goals

- Reduce manual entry of amount, date, type, account, category, and note.
- Keep the existing transaction posting path as the source of truth.
- Prevent the same financial document from creating multiple transactions.
- Keep sensitive images out of Supabase Storage and other persistent storage.
- Run through the existing Cloudflare Worker and Supabase architecture.
- Remain usable when AI extraction is unavailable by allowing manual entry.

## Non-goals

- General-purpose document scanning.
- PDFs, HEIC, invoices, statements, or multi-page documents in the first
  release.
- Automatic transaction posting without user confirmation.
- Long-term storage or later display of the uploaded image.
- Training a custom OCR or vision model.
- Perfect merchant, account, or category classification.

## User Experience

### Entry point

The transaction page adds a separate `อ่านสลิป` action next to
`เพิ่มรายการ`. The action opens a focused import dialog. On supported mobile
devices, the file input allows choosing an existing image or using the camera.

### Step 1: Select an image

The dialog:

- Accepts one JPG, PNG, or WebP image.
- Rejects unsupported files and files larger than 5 MB.
- Explains before upload that Cloudflare AI processes the image and the
  application does not retain it.
- Shows a local preview.
- Prepares the image in the browser when necessary by correcting orientation,
  reducing its longest edge to at most 2,000 pixels, and encoding it as a
  supported format without increasing the file size.
- Computes a SHA-256 fingerprint from the prepared bytes.

No image bytes are written to browser storage.

### Step 2: Analyze

The UI displays two distinct progress states:

1. `กำลังตรวจสลิปซ้ำ`
2. `กำลังอ่านยอดและรายละเอียด`

The submit control is disabled while a request is active. Cancelling the dialog
removes the local preview and draft from memory.

### Step 3: Review

Successful extraction opens the existing transaction form with suggested
values:

- Transaction type: income or expense.
- Amount and currency.
- Financial date.
- Account.
- Category.
- Note containing useful merchant, sender, or recipient details.
- Document reference for audit and duplicate detection.

The review also shows the detected document kind and confidence for extracted
fields. Low-confidence or missing fields use a visible
`โปรดตรวจสอบ` warning. The user can edit every financial field. Account and
category remain required.

The image preview is available only during this review dialog. It is discarded
when the dialog closes, the user returns to manual entry, or posting succeeds.

### Duplicate result

If the image fingerprint or canonical document identity belongs to a
previously posted document in the same workspace, the flow stops. It shows the
existing transaction's amount, financial date, and note when available, and
provides a link to the existing transaction list. There is no override in the
first release.

## Architecture

### Web application

New focused units:

- `SlipImportDialog`: owns selection, preview, progress, extraction errors, and
  the review transition.
- `prepareSlipImage`: validates the browser file, normalizes orientation and
  dimensions, and returns supported bytes plus MIME metadata.
- `fingerprintSlipImage`: computes SHA-256 from the exact prepared bytes sent
  to the API.
- `SlipDraftReview`: displays extraction metadata and passes a typed draft to
  the existing `TransactionForm`.
- Transaction form draft support: initializes type, amount, date, account,
  category, and note from a slip draft without changing manual-entry behavior.

The browser never calls Workers AI directly. It sends a multipart request to
the authenticated Worker API.

### Contracts

Shared contracts define:

- Supported document kinds: `bank_transfer` and `receipt`.
- Suggested transaction types: `income` and `expense`.
- Extracted values and per-field confidence.
- Duplicate match details.
- Analysis success, duplicate, unsupported-document, and retryable failure
  outcomes.
- A confirmation input that includes a server-issued analysis token and the
  final reviewed transaction input.

All monetary values remain decimal strings. Dates use `YYYY-MM-DD`.

### Worker API

The authenticated API adds:

- `POST /v1/slip-imports/analyze`
  - Accepts one multipart image, workspace ID, client-computed fingerprint,
    and client mutation ID.
  - Recomputes the fingerprint server-side.
  - Authorizes workspace access before duplicate lookup or AI inference.
  - Checks the image fingerprint before calling AI.
  - Invokes the extraction adapter.
  - Validates the model response against the shared schema.
  - Builds and checks a canonical document identity after extraction.
  - Returns a short-lived, signed analysis token containing the authoritative
    workspace, fingerprint, document identity hash, document kind, and
    expiry.

- `POST /v1/slip-imports/confirm`
  - Accepts the signed analysis token and the user-reviewed transaction input.
  - Revalidates authentication, workspace membership, token integrity, and
    token expiry.
  - Posts the transaction and records the document fingerprint atomically.
  - Returns the normal posted-transaction response.

The analysis token prevents the client from replacing the fingerprint or
reference between analysis and confirmation. Tokens expire after 15 minutes
and are not persisted.

### Workers AI adapter

The Worker uses an `AI` binding and
`@cf/meta/llama-3.2-11b-vision-instruct`. The adapter:

- Sends the prepared image with a narrowly scoped Thai/English extraction
  prompt.
- Requests JSON Mode with an explicit JSON Schema.
- Uses deterministic settings and a small output limit.
- Requires the model to return null rather than invent missing fields.
- Separates raw extraction from local account and category suggestion logic.
- Validates the response with Zod before returning it to the route.

The model first classifies the document as a bank transfer slip, receipt, or
unsupported. For supported documents it extracts amount, currency, date,
time, reference, merchant, sender, recipient, institutions, and confidence
values.

### Account and category suggestions

Suggestions are deterministic application logic layered on top of extraction:

- Account matching compares normalized institution and account names already
  available in the workspace.
- If exactly one strong account match exists, it is suggested.
- Otherwise the user's current/default account is retained and marked for
  review.
- Category matching uses document kind, transaction type, merchant text, and
  existing category names.
- If there is no strong category match, the first valid category for the
  suggested type is selected and marked for review.

AI does not receive the user's full transaction history. Only the current
image and the extraction instructions are sent to the model.

## Duplicate Prevention and Persistence

Add a workspace-scoped `financial_document_imports` table containing:

- `id`
- `workspace_id`
- `transaction_id`
- `document_kind`
- `image_sha256`
- `document_identity_sha256`, nullable when no reliable reference exists
- `created_by`
- `created_at`

The table stores hashes, not raw reference text. It has:

- A unique constraint on `(workspace_id, image_sha256)`.
- A partial unique constraint on
  `(workspace_id, document_identity_sha256)` when the identity hash is present.
- A foreign key to the posted transaction.
- RLS policies matching workspace membership.

A canonical document identity combines document kind, normalized institution
or merchant, normalized reference, date, currency, and amount. Text is
normalized by trimming, Unicode normalization, case folding, and removing
formatting whitespace and separators. Including the issuer and financial
details prevents unrelated banks or shops that reuse the same short reference
from colliding. The identity is created only when the reference and the other
required identity fields are reliable. The server owns normalization and
hashing.

Analysis performs an early duplicate lookup to avoid unnecessary AI usage.
Confirmation performs the authoritative duplicate insert in the same database
transaction as transaction posting. A uniqueness conflict becomes a duplicate
response rather than a generic server error. This closes the race where two
tabs analyze and confirm the same document concurrently.

A failed analysis does not create a fingerprint row. A successful analysis
that the user cancels also creates no row.

Add a separate `slip_analysis_attempts` table containing only user ID,
workspace ID, and attempt time. A database function checks and records an
allowed attempt immediately before inference. Rows older than 24 hours can be
deleted opportunistically during later checks. This makes the limits consistent
across Worker instances without requiring another Cloudflare product.

## Security and Privacy

- Authentication and workspace authorization are required for both endpoints.
- The server verifies MIME magic bytes and supported image structure rather
  than trusting the filename or browser header.
- The server enforces the 5 MB limit independently of the browser.
- Image bytes remain in request memory only and are not logged, cached, written
  to Supabase Storage, or included in observability payloads.
- The upload dialog discloses that the image is sent to Cloudflare AI for
  extraction even though the application does not retain it.
- Error logs include request IDs and failure categories, never image bytes,
  extracted names, raw references, or full model responses.
- A rolling limit of 10 analysis attempts per authenticated user per hour and
  30 attempts per workspace per UTC day protects the Workers AI quota.
- The analysis token is signed with a dedicated Worker secret, is scoped to the
  authenticated user and workspace, and expires after 15 minutes.
- The confirmation route accepts final financial fields from the user but
  trusts document identity only from the signed token.
- The Worker returns generic extraction errors without leaking model prompts or
  internals.

## Error Handling

- Unsupported type or oversized file: reject before upload when possible and
  recheck on the server.
- Invalid or unreadable image: explain that the user should retake or choose a
  clearer image.
- Unsupported document: offer manual transaction entry without keeping the
  image.
- Low-confidence extraction: populate reliable fields, flag uncertain fields,
  and require review.
- Missing amount: do not allow confirmation until the user enters a valid
  positive amount.
- Workers AI unavailable, quota exceeded, timeout, or JSON Mode failure: keep
  the transaction page usable, show a retry option, and offer manual entry.
- Duplicate: show the existing transaction and block confirmation.
- Expired analysis token: require re-analysis because the image is not stored.
- Confirmation race: return the duplicate result produced by the database
  uniqueness constraint.

## Rate Limits and Free-Tier Behavior

Workers AI currently includes a free allocation, but the application must not
assume inference is always available. The first release allows 10 analysis
attempts per authenticated user per rolling hour and 30 attempts per workspace
per UTC day. Duplicate image checks do not consume an analysis attempt because
they return before inference. The API returns a clear retry-later state when
either application limits or provider capacity are exhausted.

Local automated tests use a fake AI adapter. Manual local testing may use the
remote Workers AI binding and therefore consumes Workers AI allocation.

## Testing Strategy

### Contracts

- Accept complete and partial supported extraction results.
- Reject malformed money, dates, confidence values, and unexpected fields.
- Validate duplicate and retryable outcomes.
- Validate confirmation input and analysis token metadata.

### Web

- Select, preview, remove, and replace an image.
- Reject unsupported and oversized images.
- Disable repeated submissions during analysis.
- Render progress, unsupported, retryable, duplicate, and review states.
- Populate every supported transaction form field from a draft.
- Preserve normal manual transaction behavior.
- Mark low-confidence fields and require missing mandatory fields.
- Clear image bytes and preview URLs on close and success.
- Verify keyboard focus, labels, announcements, and mobile layout.

### Worker

- Require authentication and workspace authorization.
- Recompute and compare image fingerprints.
- Avoid the AI call when an image fingerprint is already known.
- Validate AI output and build canonical document identity hashes.
- Return a signed, expiring analysis token.
- Reject modified, expired, wrong-user, and wrong-workspace tokens.
- Handle AI timeout, quota, malformed output, and unsupported documents.
- Confirm a reviewed transaction and fingerprint atomically.

### Database

- Enforce workspace-scoped uniqueness for image and reference hashes.
- Allow the same hash in different workspaces.
- Enforce RLS and transaction ownership.
- Roll back both transaction and fingerprint when either write fails.
- Convert concurrent unique conflicts to duplicate results.

### Release verification

- Run unit and integration tests.
- Run Supabase database tests.
- Run TypeScript type checking.
- Build the web application and Worker dry run.
- Test local image upload with representative Thai bank slips and receipts
  whose sensitive data has been redacted.
- Smoke test production on desktop and mobile widths after deployment.

## Deployment and Configuration

- Add the `AI` Workers AI binding to `wrangler.jsonc`.
- Add a required `SLIP_ANALYSIS_TOKEN_SECRET` Worker secret.
- Apply the Supabase migration before deploying code that calls the new
  endpoints.
- Accept the selected model's license in the Cloudflare account before the
  first production inference.
- No Supabase Storage bucket is required.
- Deploy behind the existing authenticated Worker routes.

## Acceptance Criteria

- An authenticated user can upload or photograph a supported image from the
  transaction page.
- A supported image produces a reviewable draft without persisting the image.
- The user can correct all suggested financial fields before confirmation.
- No transaction is posted before explicit confirmation.
- The same image or reliable document reference cannot create two transactions
  in one workspace.
- Duplicate checks remain correct under concurrent confirmation.
- AI failures never create transactions or fingerprint records.
- Manual transaction entry remains available when AI is unavailable.
- The feature works at desktop and mobile widths and passes the project's test,
  typecheck, build, and database verification commands.
