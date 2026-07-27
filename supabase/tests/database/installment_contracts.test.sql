begin;

select plan(10);

select has_table('public', 'installment_contracts');
select has_table('public', 'installment_schedule_rows');
select has_table('public', 'installment_payments');
select has_table('public', 'installment_payoffs');
select has_table('public', 'installment_cash_movements');

select has_function(
  'public',
  'create_installment_contract',
  array['jsonb']
);
select has_function(
  'public',
  'post_installment_payment',
  array['jsonb']
);
select has_function(
  'public',
  'post_installment_payoff',
  array['jsonb']
);

select policies_are(
  'public',
  'installment_contracts',
  array['installment_contract_select_member']
);
select policies_are(
  'public',
  'installment_schedule_rows',
  array['installment_schedule_select_member']
);

select * from finish();
rollback;
