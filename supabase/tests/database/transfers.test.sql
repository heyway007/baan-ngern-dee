begin;

select plan(4);

select has_table('public', 'transfers');
select has_table('public', 'transfer_links');
select has_function('public', 'post_transfer', array['jsonb']);
select policies_are(
  'public',
  'transfers',
  array['transfer_select_member']
);

select * from finish();
rollback;
