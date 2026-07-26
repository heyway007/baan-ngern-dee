begin;

select plan(3);

select has_table('public', 'accounts');
select has_function(
  'public',
  'create_account',
  array['uuid', 'text', 'account_type', 'text', 'text']
);
select policies_are(
  'public',
  'accounts',
  array[
    'account_insert_editor',
    'account_select_member',
    'account_update_editor'
  ]
);

select * from finish();
rollback;
