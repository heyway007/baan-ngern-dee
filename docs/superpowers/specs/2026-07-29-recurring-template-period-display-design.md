# Recurring Template Period Display Design

## Goal

Make the active period of every recurring template visible in the
“รายการประจำทั้งหมด” list. Users must be able to tell when a template
starts, whether it has an end month, and which month is the last included
month without opening the edit form.

## Existing Behavior

The recurring template contract, API, in-memory repository, Supabase
schema, and materialization function already support an optional
`endMonth`. The end month is inclusive, and no occurrence is created for
a later month. The create and edit form already accepts this value.

No API or database migration is required for this change.

## User Interface

Each recurring template card will add a period line below its amount and
day-of-month line.

- With an end month:
  `เริ่ม ก.ค. 2026 · สิ้นสุด ธ.ค. 2026`
- Without an end month:
  `เริ่ม ก.ค. 2026 · ไม่มีกำหนดสิ้นสุด`

Month names and years will be formatted for the Thai locale. Formatting
will be isolated in a small helper so the card component remains easy to
read and the behavior can be tested independently.

The period remains visible for active, paused, and cancelled templates
because historical templates still need an understandable date range.

## Data Flow and Validation

`RecurringTemplateManager` receives `startMonth` and optional `endMonth`
from the existing `RecurringTemplate` model. It only formats and displays
those values; it does not infer or change them.

The existing validation remains authoritative:

- `startMonth` and `endMonth` use `YYYY-MM`.
- `endMonth`, when present, cannot precede `startMonth`.
- The end month is included when materializing occurrences.

## Error Handling

Contract validation prevents invalid month strings from reaching the
component. The formatter will nevertheless avoid timezone conversion by
parsing the year and month directly, preventing an off-by-one-month result
from local timezone differences.

## Testing

Component tests will verify:

1. A template with `endMonth` displays both localized boundary months.
2. A template without `endMonth` displays “ไม่มีกำหนดสิ้นสุด”.
3. The existing template actions and status display continue to work.

Focused recurring tests, TypeScript checks, the production build, and the
full test suite will run before the change is pushed.
