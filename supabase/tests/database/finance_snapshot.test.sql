begin;

select plan(3);

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

select * from finish();
rollback;
