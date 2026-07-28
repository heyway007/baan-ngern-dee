begin;
select plan(5);
select has_table('public', 'financial_document_imports');
select has_table('public', 'slip_analysis_attempts');
select has_function(
  'public', 'find_financial_document_duplicate',
  array['uuid', 'text', 'text']
);
select has_function(
  'public', 'consume_slip_analysis_quota', array['uuid']
);
select has_function(
  'public', 'confirm_financial_document_import', array['jsonb']
);
select * from finish();
rollback;
