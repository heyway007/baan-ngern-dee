# Overview Profile Name Sync Design

## Goal

The Overview page must immediately show the latest server-confirmed profile
display name after the user edits it. Both visible name references in the page
heading must stay in sync:

- `สวัสดี <ชื่อที่แสดง>`
- `บ้านเงินของ <ชื่อที่แสดง>`

## Current Problem

The profile page and application layout render `effectiveProfileState.profile`,
but `OverviewPage` still renders `session.displayName` and the workspace name
captured when the workspace was created. A successful profile edit therefore
updates the sidebar while leaving the Overview heading stale.

## Design

`FinanceRoutes` will pass the current effective profile display name to
`OverviewPage`. `OverviewPage` will render both heading lines from that value.
The display-only text will not update or rename the persisted workspace record.

This keeps profile identity and workspace data separate:

- Profile display name is the source of truth for personal UI labels.
- Workspace name remains unchanged in Supabase.
- No database migration or API change is required.

## Data Flow

1. `ProfilePage` receives the updated profile from `ProfileApi`.
2. `onProfileChanged` stores the confirmed profile in `profileState`.
3. `effectiveProfileState.profile.displayName` flows into `OverviewPage`.
4. Navigating to Overview renders both name references from the updated value.

While the profile request is pending or fails, the existing session-derived
fallback profile remains available, preserving the current resilient behavior.

## Testing

Add a router-level regression test that:

1. edits and saves the profile name;
2. navigates from Profile to Overview;
3. verifies both the greeting and personal workspace label use the confirmed
   profile name;
4. verifies the finance snapshot is not reloaded solely because the name
   changed.

Existing Overview component tests will be updated to use the profile display
name contract instead of the full authentication session.
