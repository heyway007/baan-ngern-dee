begin;

select plan(19);

select has_table('public', 'user_invitations');
select has_table('public', 'user_invitation_audit');
select has_function(
  'public',
  'create_user_invitation',
  array['text', 'text', 'text', 'uuid']
);
select has_function(
  'public',
  'claim_user_invitation',
  array['text']
);
select has_function(
  'public',
  'reconcile_user_invitation',
  array['text']
);
select policies_are(
  'public',
  'user_invitations',
  array[]::text[],
  'invitation rows have no client policies'
);
select policies_are(
  'public',
  'user_invitation_audit',
  array[]::text[],
  'invitation audit rows have no client policies'
);
select function_privs_are(
  'public',
  'invitation_auth_user_exists',
  array['text'],
  'service_role',
  array['EXECUTE']
);
select function_privs_are(
  'public',
  'create_user_invitation',
  array['text', 'text', 'text', 'uuid'],
  'service_role',
  array['EXECUTE']
);
select function_privs_are(
  'public',
  'list_user_invitations',
  array[]::text[],
  'service_role',
  array['EXECUTE']
);
select function_privs_are(
  'public',
  'inspect_user_invitation',
  array['text'],
  'service_role',
  array['EXECUTE']
);
select function_privs_are(
  'public',
  'reconcile_user_invitation',
  array['text'],
  'service_role',
  array['EXECUTE']
);
select function_privs_are(
  'public',
  'claim_user_invitation',
  array['text'],
  'service_role',
  array['EXECUTE']
);
select function_privs_are(
  'public',
  'complete_user_invitation',
  array['uuid', 'uuid', 'uuid'],
  'service_role',
  array['EXECUTE']
);
select function_privs_are(
  'public',
  'release_user_invitation',
  array['uuid', 'uuid'],
  'service_role',
  array['EXECUTE']
);
select function_privs_are(
  'public',
  'revoke_user_invitation',
  array['uuid', 'uuid'],
  'service_role',
  array['EXECUTE']
);
select function_privs_are(
  'public',
  'replace_user_invitation',
  array['uuid', 'text', 'uuid'],
  'service_role',
  array['EXECUTE']
);
select function_privs_are(
  'public',
  'claim_user_invitation',
  array['text'],
  'anon',
  array[]::text[]
);
select function_privs_are(
  'public',
  'claim_user_invitation',
  array['text'],
  'authenticated',
  array[]::text[]
);

select * from finish();
rollback;
