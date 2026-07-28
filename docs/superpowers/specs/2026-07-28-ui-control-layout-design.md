# UI Control Layout Design

## Goals

- Align the recurring-page month input and “เพิ่มรายการประจำ” button on
  the same baseline while keeping both controls at the existing
  `2.7rem` height.
- Present sign-up fields in a natural visual, DOM, and keyboard order.

## Root causes

### Recurring-page actions

The shared `.page-actions` container uses `align-items: center`. The
month selector contains both a visible label and an input, so centering
the entire selector places the adjacent button higher than the input.

### Sign-up fields

The confirmation-password field and Turnstile widget are nested inside
the display-name block before the shared email and password fields.
This produces the incorrect visual and keyboard order:

1. Display name
2. Confirm password
3. Turnstile
4. Email
5. Password

## Design

### Recurring-page alignment

Add a page-scoped alignment rule for `.recurring-page .page-actions`
that uses `align-items: flex-end`.

- The visible “เดือนที่แสดง” label remains above the input.
- The month input and compact primary button keep their current height.
- The bottom edges of the input and button align.
- Shared page heading and action styles remain unchanged.
- Existing responsive behavior remains unchanged.

### Sign-up field order

Move the sign-up-only confirmation-password field and Turnstile widget
after the shared email and password fields. Do not use CSS `order`, so
visual order and keyboard navigation remain identical.

The final sign-up sequence is:

1. Display name
2. Email
3. Password
4. Confirm password
5. Turnstile
6. Submit button

Sign-in and password-reset modes keep their current fields and behavior.
Validation, authentication payloads, and Turnstile behavior remain
unchanged.

## Verification

- Add a focused style regression test for the scoped alignment rule.
- Add a sign-up regression test that checks the form controls appear in
  the required DOM order.
- Run the style tests, typecheck, and production build.
- Inspect the recurring page at desktop width and the sign-up page at
  mobile width.
