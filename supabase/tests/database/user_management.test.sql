begin;

select plan(18);

select has_table('public', 'user_admin_audit');
select policies_are(
  'public',
  'user_admin_audit',
  array[]::text[],
  'user admin audit has no browser policies'
);
select has_function(
  'public',
  'list_admin_users',
  array['text', 'integer', 'timestamp with time zone', 'uuid']
);
select has_function(
  'public',
  'record_user_admin_action',
  array['uuid', 'uuid', 'text', 'jsonb']
);
select has_function(
  'public',
  'get_user_deletion_state',
  array['uuid', 'uuid']
);
select has_function(
  'public',
  'purge_private_user_data',
  array['uuid', 'uuid', 'uuid', 'text']
);
select has_function(
  'public',
  'complete_user_deletion',
  array['uuid', 'uuid', 'uuid']
);
select function_privs_are(
  'public',
  'list_admin_users',
  array['text', 'integer', 'timestamp with time zone', 'uuid'],
  'service_role',
  array['EXECUTE']
);
select function_privs_are(
  'public',
  'record_user_admin_action',
  array['uuid', 'uuid', 'text', 'jsonb'],
  'service_role',
  array['EXECUTE']
);
select function_privs_are(
  'public',
  'get_user_deletion_state',
  array['uuid', 'uuid'],
  'service_role',
  array['EXECUTE']
);
select function_privs_are(
  'public',
  'purge_private_user_data',
  array['uuid', 'uuid', 'uuid', 'text'],
  'service_role',
  array['EXECUTE']
);
select function_privs_are(
  'public',
  'complete_user_deletion',
  array['uuid', 'uuid', 'uuid'],
  'service_role',
  array['EXECUTE']
);
select function_privs_are(
  'public',
  'list_admin_users',
  array['text', 'integer', 'timestamp with time zone', 'uuid'],
  'anon',
  array[]::text[]
);
select function_privs_are(
  'public',
  'list_admin_users',
  array['text', 'integer', 'timestamp with time zone', 'uuid'],
  'authenticated',
  array[]::text[]
);
select function_privs_are(
  'public',
  'purge_private_user_data',
  array['uuid', 'uuid', 'uuid', 'text'],
  'anon',
  array[]::text[]
);
select function_privs_are(
  'public',
  'purge_private_user_data',
  array['uuid', 'uuid', 'uuid', 'text'],
  'authenticated',
  array[]::text[]
);
select col_is_fk(
  'public',
  'user_invitations',
  'redeemed_user_id',
  'invitation redemption still references Auth users'
);
select is(
  (
    select constraint_row.confdeltype
    from pg_constraint constraint_row
    where constraint_row.conname =
      'user_invitations_redeemed_user_id_fkey'
  ),
  'n',
  'deleting an Auth user preserves invitation history'
);

select * from finish();
rollback;
