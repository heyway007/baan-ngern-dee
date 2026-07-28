# Slip AI Retry and Success-Only Quota Design

## Goal

Make slip analysis resilient to temporary Cloudflare Workers AI failures while
preserving the workspace limit of 30 analyzed images per UTC day.

The same valid image should normally succeed without requiring the user to press
retry, and a provider or malformed-response failure must not consume the daily
quota.

## Current Problem

The Worker currently calls the vision model once. A provider rejection, empty
answer, invalid JSON, or invalid normalized shape immediately becomes
`AI_UNAVAILABLE`.

The quota is consumed before the model call. Therefore temporary provider
failures count against the 30-image allowance even though no usable analysis was
returned. The web application also presents all non-rate-limit failures using
the same generic message.

Production observability on 2026-07-29 showed eight recent
`AI_UNAVAILABLE` events: six `provider` failures and two `invalid_json`
failures.

## Selected Approach

Retry the Workers AI extraction inside the Worker and move the quota mutation to
after a usable provider response.

No database migration is required. The existing atomic
`consume_slip_analysis_quota` RPC remains the final authority for the daily
limit.

## Analysis Flow

1. Validate the image, server-side hash, workspace access, and duplicate image
   exactly as today.
2. Read the current workspace quota without mutating it.
3. If the workspace is already at 30 images, return `RATE_LIMITED` without
   calling Workers AI.
4. Call the vision extractor.
5. Retry a failed extraction up to two additional times, for a maximum of three
   model calls for one uploaded image.
6. Retry only bounded vision failures:
   `provider`, `empty_answer`, `invalid_json`, and `invalid_shape`.
7. Wait 300 milliseconds before the second attempt and 900 milliseconds before
   the third attempt.
8. Once extraction returns a valid normalized result, atomically consume one
   quota unit.
9. If another concurrent request fills the final quota slot first, return
   `RATE_LIMITED` and do not issue an analysis token.
10. Continue the existing unsupported-document, document-identity duplicate,
    token, review-draft, and confirmation flows.

An `unsupported` result counts as one analyzed image because Workers AI
successfully processed and classified it. A request that exhausts all three
attempts does not consume quota.

## Concurrency and Idempotency

The browser continues to analyze at most two images concurrently.

Moving quota consumption after extraction cannot exceed 30 successful analyses:
the existing PostgreSQL advisory lock serializes the final quota mutation. At
the boundary, more than one model call may run while one slot remains, but only
one request can consume that slot and return an analysis result.

Duplicate checks remain before model inference, so an already recorded image
does not consume Workers AI or daily quota. Transaction confirmation remains
protected by the existing image hash, document identity, analysis token, and
client mutation identifiers.

## Error Handling and Observability

Each failed model attempt emits a structured warning containing only bounded
diagnostic fields:

- failure category;
- attempt number from 1 to 3;
- request ID;
- request path.

Raw model answers, image bytes, account details, and extracted financial data
must not be logged.

After the first or second transient failure, the Worker retries silently. After
the third failure it returns `AI_UNAVAILABLE`, which the existing error handler
logs with the final category and request ID.

The web application will distinguish:

- `RATE_LIMITED`: daily 30-image allowance is full;
- `AI_UNAVAILABLE`: Workers AI was retried and is temporarily unavailable, and
  the failed image was not counted;
- validation failures: unsupported file type, invalid image, or size problem.

The existing per-row retry action remains available.

## Testing

### Vision extractor/service tests

- succeeds on the first attempt without waiting;
- retries a `provider` failure and succeeds on the second attempt;
- retries malformed JSON and succeeds on the third attempt;
- stops after three bounded failures and returns `AI_UNAVAILABLE`;
- does not retry an unexpected programming error;
- does not consume quota when all attempts fail;
- consumes quota exactly once after a successful extraction;
- counts an `unsupported` classification exactly once;
- short-circuits before inference when quota is already full;
- handles the final-slot concurrency race by returning `RATE_LIMITED` without
  issuing a token.

### Web tests

- shows that an exhausted AI retry did not consume quota;
- retains the manual row retry action;
- continues to show the dedicated 30-image limit state.

### Regression verification

- focused slip vision, slip import service, route, and dialog tests;
- TypeScript checks;
- production build;
- complete test suite.

## Out of Scope

- changing the Workers AI model;
- adding a second fallback model;
- changing the 30-image daily limit;
- storing uploaded slip images;
- changing duplicate detection or batch transaction confirmation.
