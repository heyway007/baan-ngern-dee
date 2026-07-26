begin;

select plan(5);

select has_table('public', 'workspaces');
select has_table('public', 'categories');
select has_function(
  'public',
  'create_private_workspace',
  array['text', 'text', 'text']
);
select policies_are(
  'public',
  'workspaces',
  array['workspace_select_member', 'workspace_update_owner']
);
select policies_are(
  'public',
  'categories',
  array[
    'category_insert_editor',
    'category_select_member',
    'category_update_editor'
  ]
);

select * from finish();
rollback;
