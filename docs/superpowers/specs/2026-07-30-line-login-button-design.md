# LINE Login Button Design

## Goal

Add a visible LINE sign-in entry to the existing `/sign-in` page so the same
LINE account can open the same finance workspace from a desktop or mobile
browser.

## User experience

- Show a full-width green `เข้าสู่ระบบด้วย LINE` action above the email form
  in sign-in and sign-up modes.
- Follow it with a divider labelled `หรือเข้าสู่ระบบด้วยอีเมล`.
- Hide the LINE action in password-reset mode.
- The LINE action navigates to `/line?next=/overview`.

## Reused flow

The button reuses the current `/line` route, custom Supabase LINE provider,
`/line/callback`, safe destination storage, and workspace bootstrap. It does
not introduce a second OAuth implementation. An existing LINE identity opens
its existing workspace; a new LINE identity follows the existing private
workspace creation flow.

## Error handling

OAuth and callback failures continue to use the existing controlled LINE retry
page. Email sign-in, sign-up, and password-reset behavior remains unchanged.

## Verification

- Component tests verify the LINE action URL and visibility by auth mode.
- Router tests continue to cover LINE OAuth and callback behavior.
- Run web tests, type checking, and a production build.
- Run the app locally and inspect the desktop and mobile sign-in layouts before
  any push or deployment.
