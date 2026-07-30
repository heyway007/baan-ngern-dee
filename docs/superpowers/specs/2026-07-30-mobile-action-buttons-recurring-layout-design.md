# Mobile Action Buttons and Recurring Header Design

## Goal

Make mobile header actions visually consistent and prevent the recurring-page
month selector from colliding with its heading or form toggle.

## Scope

- Mobile layouts at `620px` and below.
- Header actions on accounts, transactions, installments, and recurring pages.
- Icon-only actions such as add, close, scan, and settings controls that appear
  inside page headings.
- The recurring-page month selector and add/close toggle.

Desktop layouts and action wording remain unchanged.

## Design

### Shared mobile action size

All icon-only page-heading actions use one exact `44px by 44px` control size.
The size includes the border through `box-sizing: border-box`, does not shrink
inside flex or grid layouts, and keeps the icon centered. Existing accessible
button names remain available while visible text is hidden on mobile.

The shared rule replaces page-specific width assumptions so add and close
states cannot render at different sizes.

### Mobile page headings

Mobile page headings place descriptive content on the first row and page
actions on a separate row. This prevents long Thai headings and multiple
actions from competing for horizontal space.

Pages with one action align it to the right. Pages with several actions keep a
compact right-aligned action group, with every icon action using the same
44-pixel size.

### Recurring month controls

The recurring page gives its controls the full available width below the
heading. The month selector fills the flexible column and the add/close button
occupies a fixed 44-pixel column on the right. The selector may shrink without
overflowing, and the button may not shrink.

At very narrow widths, the control row still remains within the content card
and does not overlap the heading, month label, or month input.

## Accessibility

- Interactive targets meet the 44-pixel mobile touch-target minimum.
- Existing `button` elements and accessible names are preserved.
- Hiding button text is visual only; screen readers retain the full label.
- Focus and disabled styles continue to use the existing button system.

## Testing

- Add a stylesheet regression test for the exact mobile action dimensions.
- Assert that the mobile recurring action layout uses a flexible month column
  and a fixed 44-pixel action column.
- Keep existing recurring alignment and monthly transaction control tests.
- Run the focused stylesheet tests, the full test suite, type checking, and the
  production build.
- Verify the affected pages at a mobile viewport before deployment.

## Out of Scope

- Redesigning form submit buttons or card-level action rows.
- Changing desktop button sizes.
- Rewriting labels, icons, or page content.
- Altering recurring data behavior.
