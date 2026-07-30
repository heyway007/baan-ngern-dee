# LINE OA Rich Menu and LINE Login Design

## Goal

Add a LINE Official Account entry point for Baan Ngern Dee so a person can open
the finance application from a six-item rich menu, authenticate with their LINE
account, and receive a private finance workspace that is never shared with
another LINE user.

The feature must preserve the existing Supabase session model and database RLS.
Email/password authentication remains available for existing users, but a new
LINE user does not need to create or enter a Baan Ngern Dee password.

## User Experience

The LINE Official Account is named `บ้านเงินดี`. Its default rich menu is a
large `2500 x 1686` PNG divided into three columns and two rows:

| Position | Label | Action |
| --- | --- | --- |
| Top left | ภาพรวม | Open `/line?next=%2Foverview` |
| Top center | เพิ่มรายรับ | Open `/line?next=%2Ftransactions%2Fnew%3Ftype%3Dincome` |
| Top right | เพิ่มรายจ่าย | Open `/line?next=%2Ftransactions%2Fnew%3Ftype%3Dexpense` |
| Bottom left | บัญชี | Open `/line?next=%2Faccounts` |
| Bottom center | ผ่อนและหนี้ | Open `/line?next=%2Finstallments` |
| Bottom right | สอบถามเรา | Send the message `สอบถามเรา` in the OA chat |

The chat bar text is `เมนูบ้านเงินดี`. The artwork follows the existing web
brand: Kanit typography, forest `#214c3c`, deep forest `#15382d`, leaf
`#8aae78`, cream `#f4f2eb`, and simple line icons.

The first five areas use LINE URI actions. `สอบถามเรา` uses a LINE message
action so the conversation appears in LINE Official Account Manager for a
human administrator to answer. Automated bot replies and a custom webhook are
not required in this phase.

## Selected Approach

Use LINE Login as a Supabase custom OAuth provider.

This approach lets Supabase own OAuth state, callback validation, Auth user
creation, and session issuance. The application continues sending Supabase
access tokens to the existing Worker API, and the existing `auth.uid()`-based
RLS remains the authority for data access.

The Messaging API channel used by the OA and the LINE Login channel must belong
to the same LINE Provider. This keeps the account structure coherent and avoids
creating unrelated LINE developer projects for one product.

The alternatives are rejected:

- A custom LIFF-to-Worker token exchange would make the application responsible
  for minting or bridging Supabase sessions and add avoidable security surface.
- Opening the site from LINE while requiring a separate email/password account
  does not meet the requirement that LINE be the primary identity.

## Components

### LINE configuration

The owner creates:

1. a LINE Official Account named `บ้านเงินดี`;
2. its Messaging API channel;
3. a LINE Login channel under the same LINE Provider;
4. a Web App entry with the production callback URL required by Supabase.

The LINE Login channel requests only the scopes needed for authentication and a
friendly first-use name: `openid` and `profile`. Email is not required.

### Supabase custom OAuth provider

Configure an enabled custom provider with identifier `custom:line`, using the
LINE Login OAuth 2.1 authorize, token, and user-info endpoints. Set the provider
to allow identities without email.

The LINE channel ID and channel secret live in Supabase Auth provider
configuration. They are not committed to Git, returned by `/config`, or exposed
as `VITE_*` values.

### Web LINE entry and callback

Add a public `/line` route that:

1. reads `next`;
2. accepts only a known internal application destination;
3. stores the validated destination for the current browser tab;
4. starts `signInWithOAuth({ provider: "custom:line" })` when no Supabase
   session exists;
5. shows `กำลังพาเข้าสู่บ้านเงินดี` while authentication is in progress;
6. continues to workspace bootstrap after the OAuth callback; and
7. navigates to the saved destination after the snapshot contains a workspace.

If an authenticated user opens `/line`, the route skips OAuth and goes directly
to the validated destination. This makes repeat rich-menu use fast while the
Supabase session is valid.

The allowlist contains only:

- `/overview`;
- `/transactions/new?type=income`;
- `/transactions/new?type=expense`;
- `/accounts`;
- `/installments`.

Unknown, absolute, protocol-relative, malformed, or missing destinations fall
back to `/overview`. The destination may be kept in `sessionStorage`; LINE ID
tokens, channel secrets, and Messaging API access tokens must never be stored
there.

### Personal workspace bootstrap

After LINE authentication, the existing snapshot request determines whether
the Supabase user already owns an active private workspace.

For a first-time LINE user with no workspace, the web application calls the
existing authenticated private-workspace creation API with:

- name: `บ้านเงินของ {LINE display name}`;
- kind: `private`;
- base currency: `THB`;
- time zone: `Asia/Bangkok`.

The name is trimmed to the existing 80-character database limit. If no usable
LINE display name is present, use `การเงินของฉัน`.

Workspace creation remains transactional in the repository: workspace,
owner membership, and default categories either succeed together or fail
together. The existing partial unique index on active private workspaces makes
the operation safe against duplicate concurrent requests. A retry that loses a
creation race reloads the snapshot and uses the workspace that now exists.

Creating the Supabase Auth identity and creating the finance workspace are
separate operations. If workspace creation fails, the Auth user may safely
remain without finance data; the entry route shows a retry action and retries
the idempotent bootstrap later.

### Rich menu artifacts

The repository receives:

- the final PNG under `apps/web/public/line/`;
- a rich-menu definition JSON with exact tap coordinates and production URLs;
- a setup script or documented API commands that validate the definition,
  create the menu, upload the image, and set it as the default; and
- a setup runbook for the LINE and Supabase console steps.

The PNG must be JPEG/PNG-compatible, no larger than 1 MB, and visually checked
at mobile scale. The image and JSON use the same `2500 x 1686` coordinate
system.

No LINE secret or long-lived access token is written to an artifact. A
Messaging API access token is supplied locally only when the owner provisions
the rich menu.

## Authentication and Data Flow

1. The user opens the OA chat and taps a web action.
2. LINE opens the production `/line` URL in its in-app browser.
3. The web application validates and saves the requested internal destination.
4. Supabase Auth redirects through LINE Login.
5. LINE authenticates and consents to `openid profile`.
6. Supabase validates the callback, creates or finds the Auth identity, and
   establishes the normal Supabase browser session.
7. The application loads `/v1/snapshot` with the Supabase bearer token.
8. If there is no private workspace, the application calls the existing
   workspace creation API and reloads the snapshot.
9. The router navigates to the rich-menu destination.
10. All later finance requests use the existing authenticated API and RLS.

Each LINE identity maps to one Supabase Auth user. Each such user owns one
active private workspace. `workspace_members` and the current RLS policies
continue separating all finance records by authenticated membership.

## Existing Account Behavior

Existing email/password users keep their current login and workspaces.

Automatic merging between an existing email/password account and a new LINE
identity is intentionally excluded. Silent merging is unsafe because the LINE
profile does not have to contain a verified email. Account linking can be
designed later as an explicit, re-authenticated action.

## Error Handling

- OAuth canceled or denied: show a Thai explanation with `ลองอีกครั้ง` and a
  link to the existing sign-in page.
- Missing Supabase custom provider: show a configuration error without exposing
  provider secrets.
- Invalid `next`: continue to `/overview`.
- Snapshot temporarily unavailable: use the existing recoverable snapshot
  state and retry behavior.
- Workspace bootstrap failure: keep the valid session, show that no finance
  workspace was created, and offer an idempotent retry.
- Duplicate bootstrap race: reload the snapshot instead of showing a duplicate
  workspace error.
- OA chat action: rely on LINE message delivery and manual OA Manager chat; no
  application-side finance mutation occurs.

## Security and Privacy

- LINE client secrets stay in Supabase Auth configuration.
- Messaging API access tokens stay outside Git and browser bundles.
- The web application never trusts decoded browser-side LINE profile data as an
  authentication decision; Supabase completes the OAuth exchange.
- Redirect destinations use an explicit allowlist to prevent open redirects.
- Existing Worker authentication, workspace membership checks, and RLS remain
  mandatory for every finance operation.
- Only `openid` and `profile` are requested. The application does not request
  LINE email, friends, status message, or other unnecessary profile data.
- The first-use display name may populate `profiles.display_name` and the
  private workspace name. The LINE profile image is not stored in this phase.
- Authentication and bootstrap logs contain request IDs and bounded failure
  categories, not OAuth codes, tokens, secrets, or finance data.

## Testing

### Web tests

- unauthenticated `/line` starts `custom:line` OAuth with the correct callback;
- an authenticated session skips OAuth;
- every allowed `next` destination survives the callback and navigates
  correctly;
- external, protocol-relative, malformed, and unknown destinations fall back
  to `/overview`;
- first-time LINE login automatically creates a private workspace;
- an existing LINE user reuses the existing workspace;
- missing display name uses `การเงินของฉัน`;
- bootstrap failure shows retry without creating duplicate data;
- email/password sign-in continues to work.

### Worker and repository tests

- first bootstrap creates one private workspace, one owner membership, and
  default categories;
- repeated and concurrent creation cannot produce two active private
  workspaces;
- two different authenticated users cannot see or mutate each other's
  workspaces, accounts, transactions, or installments;
- RLS database tests continue passing for all finance tables.

### Rich menu verification

- PNG dimensions are exactly `2500 x 1686`;
- PNG size is no more than 1 MB;
- JSON bounds cover the intended six non-overlapping areas;
- the five URI actions use the deployed HTTPS origin and encoded destinations;
- `สอบถามเรา` emits the exact Thai message;
- LINE's rich-menu validation endpoint accepts the object;
- each area is tapped on a real LINE mobile client before rollout.

### Regression verification

- focused router, auth, workspace, and RLS tests;
- full Vitest suite;
- database test suite;
- TypeScript checks;
- production build.

## Rollout

1. Create the OA, Messaging API channel, and LINE Login channel.
2. Configure and test `custom:line` in a non-production Supabase project or with
   a restricted test account.
3. Deploy the web entry route and bootstrap behavior while leaving existing
   sign-in available.
4. Provision a non-default test rich menu and link it to the owner's LINE user
   ID.
5. Complete real-device tests for all six areas and two separate LINE accounts.
6. Set the tested menu as the OA default.
7. Monitor Auth failures, workspace creation conflicts, and application errors.
8. Roll back by removing the default rich menu and disabling `custom:line`;
   existing email/password access remains available.

## Owner-Provided Prerequisites

Creating a LINE Official Account and accepting LINE's terms requires the
owner's interactive LINE account. Before production provisioning, the owner
must supply through local secret configuration, not chat or Git:

- LINE Login channel ID and channel secret;
- a Messaging API channel access token for rich-menu provisioning;
- access to the Supabase Auth provider settings; and
- confirmation of the final production origin.

## Out of Scope

- automatic linking or merging with an existing email/password account;
- shared or family workspaces for LINE-created users;
- bot-generated support replies, AI chat, or a custom Messaging webhook;
- storing LINE profile images;
- per-user or tab-switching rich menus;
- LINE notifications, broadcast campaigns, or payment integration;
- replacing the existing email/password sign-in flow.

## References

- [LINE rich menu overview](https://developers.line.biz/en/docs/messaging-api/rich-menus-overview/)
- [LINE Messaging API actions](https://developers.line.biz/en/docs/messaging-api/actions/)
- [LINE Messaging API rich menu reference](https://developers.line.biz/en/reference/messaging-api/nojs/)
- [LINE Login v2.1 API](https://developers.line.biz/en/reference/line-login/)
- [Supabase custom OAuth/OIDC providers](https://supabase.com/docs/guides/auth/custom-oauth-providers)

