begin;

select plan(18);

select has_table('public', 'recurring_templates');
select has_table('public', 'recurring_occurrences');

select has_function(
  'public',
  'create_recurring_template',
  array['jsonb']
);
select has_function(
  'public',
  'update_recurring_template',
  array['uuid', 'jsonb']
);
select has_function(
  'public',
  'set_recurring_template_status',
  array['uuid', 'integer', 'recurring_template_status']
);
select has_function(
  'public',
  'materialize_recurring_period',
  array['jsonb']
);
select has_function(
  'public',
  'get_recurring_period',
  array['uuid', 'text']
);
select has_function(
  'public',
  'update_recurring_occurrence',
  array['uuid', 'jsonb']
);
select has_function(
  'public',
  'skip_recurring_occurrence',
  array['uuid', 'integer']
);
select has_function(
  'public',
  'post_recurring_occurrence',
  array['uuid', 'jsonb']
);

select policies_are(
  'public',
  'recurring_templates',
  array['recurring_template_select_member']
);
select policies_are(
  'public',
  'recurring_occurrences',
  array['recurring_occurrence_select_member']
);

select has_index(
  'public',
  'recurring_occurrences',
  'recurring_occurrences_template_id_period_month_key'
);
select has_index(
  'public',
  'recurring_occurrences',
  'recurring_occurrences_transaction_id_key'
);

select ok(
  (
    select class.relrowsecurity
    from pg_class class
    join pg_namespace namespace
      on namespace.oid = class.relnamespace
    where namespace.nspname = 'public'
      and class.relname = 'recurring_templates'
  ),
  'recurring_templates has RLS enabled'
);
select ok(
  (
    select class.relrowsecurity
    from pg_class class
    join pg_namespace namespace
      on namespace.oid = class.relnamespace
    where namespace.nspname = 'public'
      and class.relname = 'recurring_occurrences'
  ),
  'recurring_occurrences has RLS enabled'
);

select table_privs_are(
  'public',
  'recurring_templates',
  'authenticated',
  array['SELECT']
);
select table_privs_are(
  'public',
  'recurring_occurrences',
  'authenticated',
  array['SELECT']
);

select * from finish();
rollback;
