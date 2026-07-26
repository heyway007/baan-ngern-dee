begin;

select plan(6);

select has_table('public', 'transactions');
select has_table('public', 'transaction_splits');
select has_view('public', 'account_balances');
select has_function('public', 'post_transaction', array['jsonb']);
select has_function(
  'public',
  'void_transaction',
  array['uuid', 'integer', 'text']
);
select has_function(
  'public',
  'create_account_with_opening_balance',
  array['jsonb']
);

select * from finish();
rollback;
