# Recurring Page Action Alignment Design

## Goal

Align the month input and the “เพิ่มรายการประจำ” button on the same
baseline while keeping both controls at the existing `2.7rem` height.

## Root cause

The shared `.page-actions` container uses `align-items: center`. The month
selector contains both a visible label and an input, so centering the
entire selector places the adjacent button higher than the input.

## Design

Add a page-scoped alignment rule for `.recurring-page .page-actions`
that uses `align-items: flex-end`.

- The visible “เดือนที่แสดง” label remains above the input.
- The month input and compact primary button keep their current height.
- The bottom edges of the input and button align.
- Shared page heading and action styles remain unchanged.
- Existing responsive behavior remains unchanged.

## Verification

- Add a focused style regression test for the scoped alignment rule.
- Run the style tests, typecheck, and production build.
- Inspect the recurring page at desktop width to confirm visual
  alignment.
