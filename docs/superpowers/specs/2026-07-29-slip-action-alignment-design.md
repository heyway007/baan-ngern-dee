# Slip Action Alignment Design

## Goal

Make every action control in the slip review table align consistently,
with equal dimensions and centered icon/label content.

## Layout

- Desktop and tablet: use a three-column grid with equal-width columns.
- Every button and file-upload label fills its grid cell and shares the
  same minimum height.
- Rows with two available actions keep the same column sizing instead of
  stretching one action wider than the others.
- Small mobile screens: use a two-column grid so labels remain readable.

## Scope

This change is CSS-only. It does not change action availability,
accessibility labels, event handling, or batch-confirmation behavior.

## Verification

- Run the slip batch table component tests.
- Run the web typecheck and production build.
- Inspect the desktop and mobile CSS rules for equal grid sizing.
