begin;

select plan(6);

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

select * from finish();
rollback;
