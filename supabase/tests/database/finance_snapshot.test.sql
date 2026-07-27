begin;

select plan(7);

select has_function(
  'public',
  'get_finance_snapshot',
  array[]::text[]
);
select function_returns(
  'public',
  'get_finance_snapshot',
  array[]::text[],
  'jsonb'
);
select function_privs_are(
  'public',
  'get_finance_snapshot',
  array[]::text[],
  'authenticated',
  array['EXECUTE']
);
select has_function(
  'public',
  'snapshot_recurring_templates',
  array['uuid']
);
select function_returns(
  'public',
  'snapshot_recurring_templates',
  array['uuid'],
  'jsonb'
);
select has_function(
  'public',
  'snapshot_recurring_occurrences',
  array['uuid', 'date']
);
select function_returns(
  'public',
  'snapshot_recurring_occurrences',
  array['uuid', 'date'],
  'jsonb'
);

select * from finish();
rollback;
