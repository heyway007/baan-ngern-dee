# Editable User Profile Design

## Summary

Add a signed-in `/profile` page where each user can change their display name
and profile photo while seeing the immutable account channel used to sign in.
The feature supports both email/password and LINE identities, updates the
visible application profile immediately after a successful mutation, and
keeps the finance application usable if profile loading temporarily fails.

## Goals

- Let a signed-in user change a display name between 1 and 80 trimmed
  characters.
- Let a signed-in user upload, replace, or remove a JPG, PNG, or WebP avatar
  up to 2 MB.
- Show an email address for email identities or `LINE` for email-less LINE
  identities as read-only account information.
- Use the LINE avatar as the default for LINE identities when available.
- Fall back to the first display-name character when no usable avatar exists.
- Open the same profile page from the desktop sidebar profile row and the
  mobile settings button.
- Keep profile images private in Supabase Storage and expose only expiring
  signed URLs.
- Complete implementation and verification locally before any push or
  production deployment.

## Non-goals

- Changing the sign-in email address or authentication provider.
- Adding biography, phone number, address, social links, or notification
  preferences.
- Editing another user's profile.
- Cropping, filters, or a full image editor.
- Synchronizing an uploaded application avatar back to LINE.

## Authoritative Data

`public.profiles` is authoritative for application-specific profile
customization.

- `display_name text` remains the editable display name.
- Add nullable `avatar_path text`.
- Add database constraints so a non-null display name is trimmed and between
  1 and 80 characters, and an avatar path belongs to the owning user prefix.
- Preserve the current self-select and self-update RLS policies.

Supabase Auth metadata remains the source for identity-provider facts:

- login email, when present;
- provider identity;
- LINE-origin display name and avatar URL used only as defaults.

The application does not let users change provider facts. Admin user listing
already prefers `profiles.display_name`, so an edited name becomes the visible
application name without treating Auth metadata as a second authority.

## Avatar Storage

Create a private Supabase Storage bucket named `profile-avatars`.

- Objects use an owner-scoped path:
  `<user-id>/<generated-file-name>.<extension>`.
- The Worker uploads and deletes objects with its server-side Supabase
  credentials after authenticating the caller.
- The bucket is not publicly readable.
- Profile reads return an expiring signed URL for a custom avatar.
- Replacing an avatar writes the new object first, updates `avatar_path`, and
  only then deletes the previous object. A failed replacement therefore keeps
  the old profile intact.
- Removing an avatar clears `avatar_path`, deletes the custom object, and
  restores the LINE or initial-letter fallback.

The Worker validates the byte length and file signature. It accepts only JPEG,
PNG, and WebP payloads up to 2 MB and does not trust the filename or declared
`Content-Type` alone.

## Profile API

All endpoints require the existing bearer-token authentication.

### `GET /v1/profile`

Returns:

```json
{
  "userId": "uuid",
  "displayName": "New Name",
  "accountChannel": {
    "kind": "email",
    "label": "person@example.com"
  },
  "avatar": {
    "source": "custom",
    "url": "https://signed-storage-url.example"
  }
}
```

`accountChannel.kind` is `email` or `line`. `avatar.source` is `custom`,
`line`, or `initial`; `url` is nullable for the initial-letter fallback.
When `profiles.display_name` is null, the response falls back to the mapped
Auth display name without writing data during a read.

### `PATCH /v1/profile`

Accepts:

```json
{
  "displayName": "New Name"
}
```

The service trims the value and rejects values outside 1–80 characters. It
updates only the authenticated user's profile and returns the complete current
profile response.

### `POST /v1/profile/avatar`

Accepts one raw image body with the matching image `Content-Type`. The Worker
enforces the 2 MB limit and validates its signature before storage. It returns
the complete profile response with a fresh signed avatar URL.

### `DELETE /v1/profile/avatar`

Removes only the authenticated user's custom avatar and returns the complete
fallback profile response. Calling it when no custom avatar exists is
idempotent.

## Web Architecture

Add a focused profile API adapter alongside the existing remote APIs. It sends
the current bearer token, parses shared contract schemas, and maps server error
codes to Thai user-facing messages.

The application router owns profile state separately from the finance
snapshot:

- derive an immediate fallback from `CloudSession` so finance pages can render;
- load the authoritative profile after a session is established;
- do not replace a ready finance screen with the global cloud error screen if
  profile loading fails;
- expose retry only within `/profile`;
- replace the in-memory profile only after a successful mutation;
- pass the effective profile to the layout so sidebar identity updates
  immediately.

This separation prevents a temporary profile failure from blocking accounts,
transactions, recurring items, installments, or the overview.

## Profile Page

Create `/profile` inside the authenticated application layout.

The page contains:

- a circular avatar preview or first-letter fallback;
- `เปลี่ยนรูป` upload action;
- `ลบรูป` action only when a custom avatar exists;
- helper text listing JPG, PNG, WebP, and the 2 MB limit;
- an editable `ชื่อที่แสดง` input;
- a read-only `ช่องทางเข้าสู่ระบบ` row showing the email address or `LINE`;
- `บันทึกการเปลี่ยนแปลง`;
- pending, success, validation, and failure states in Thai.

The display-name save and avatar mutations are independent. Choosing an image
shows a local preview, but the shared sidebar avatar changes only after the
server confirms the upload. A failed upload discards the uncommitted preview
and retains the existing profile.

The desktop sidebar profile row becomes a link to `/profile`. The mobile
settings icon becomes a link to the same route. The profile page is not added
to the main finance navigation or bottom navigation.

## Responsive Behavior

- Use the existing page content width, card, field, and button patterns.
- Keep controls at least 44 px high.
- Stack avatar actions and form actions on narrow screens.
- Prevent filenames, email labels, and error messages from forcing horizontal
  overflow.
- Preserve bottom-navigation clearance on mobile.

## Error Handling

- `PROFILE_NAME_INVALID`: show the display-name validation message beside the
  field.
- `PROFILE_IMAGE_TOO_LARGE`: explain the 2 MB maximum.
- `PROFILE_IMAGE_UNSUPPORTED`: list JPG, PNG, and WebP.
- `PROFILE_IMAGE_UPLOAD_FAILED`: keep the old avatar and offer retry.
- `PROFILE_LOAD_FAILED`: keep the session-derived fallback in the layout and
  show a retry card only on `/profile`.
- `UNAUTHENTICATED`: reuse the existing sign-out/session recovery behavior.
- Unexpected server failures use the existing request ID logging pattern and a
  generic Thai retry message.

## Security

- Authenticate before every profile read or mutation.
- Derive the target user ID from the verified access token, never from request
  input.
- Enforce owner-prefixed avatar paths.
- Keep the Storage bucket private.
- Return only expiring signed URLs.
- Reject oversized bodies before storage and validate image magic bytes.
- Never return service-role credentials, raw Auth metadata, or Storage admin
  responses to the browser.
- Escape and render display names as normal React text.

## Testing

### Contracts and API

- profile request and response schemas;
- display-name trimming and length boundaries;
- email and LINE account-channel mapping;
- custom, LINE, and initial avatar fallback order;
- unauthenticated rejection and user ownership;
- JPEG, PNG, and WebP signature acceptance;
- unsupported and oversized image rejection;
- replacement ordering that preserves the old avatar on failure;
- idempotent avatar removal.

### Web

- `/profile` is authenticated and renders the current profile;
- sidebar row and mobile settings link to `/profile`;
- display-name success updates the layout immediately;
- failed display-name save leaves the current profile unchanged;
- upload preview, success, failure, replacement, and removal;
- read-only email/LINE channel rendering;
- local profile-load failure does not block finance routes;
- mobile layout has no horizontal overflow and usable control sizes.

### Verification

- focused Vitest suites during development;
- full Vitest suite;
- TypeScript typecheck;
- production build dry run;
- local browser verification for email and LINE profile fallbacks, desktop and
  mobile navigation, name update, avatar upload, avatar removal, and failure
  states;
- no push or production deployment until the user gives a separate explicit
  instruction.

