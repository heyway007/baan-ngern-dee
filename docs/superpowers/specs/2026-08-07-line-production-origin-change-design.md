# LINE Production Origin Change Design

## Goal

Move every production LINE OA entry URL from
`https://baan-ngern-dee.newforico-9ea.workers.dev` to
`https://baan-ngern-dee.workplatform.workers.dev` without changing the LINE
Login provider callback or database schema.

## Design

The new Workers URL is the canonical public origin for the current release.
All five URI actions in the Messaging API rich menu use the canonical origin
and preserve their existing `/line?next=...` destinations. The message action
for contacting support remains unchanged.

The rich-menu validator and its tests reject definitions that do not use the
new origin. Supabase local Auth configuration and deployment runbooks use the
same origin and include `/line/callback`. Production Supabase Dashboard values
must be updated separately because dashboard configuration is not stored in
this repository.

The LINE Login callback configured in LINE Developers remains the read-only
callback URL shown by the Supabase custom OAuth provider. It is not replaced by
the website `/line/callback` URL.

## Future Routing

Keep `baan-ngern-dee.workplatform.workers.dev` stable. If the application moves
again, this Worker can later redirect its path and query string to the new
application origin, so the LINE rich menu does not need another change.

## Verification

- The LINE menu test expects the new canonical origin.
- The rich-menu validator accepts the checked-in definition.
- No tracked runtime or operations file contains the obsolete origin.
- The web test suite, typecheck, and production build remain green.

