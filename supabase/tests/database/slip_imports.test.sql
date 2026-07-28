begin;
select plan(16);
select has_table('public', 'financial_document_imports');
select has_table('public', 'slip_analysis_attempts');
select has_table('public', 'financial_document_import_batches');
select has_function(
  'public', 'find_financial_document_duplicate',
  array['uuid', 'text', 'text']
);
select has_function(
  'public', 'consume_slip_analysis_quota', array['uuid']
);
select has_function(
  'public', 'get_slip_analysis_quota', array['uuid']
);
select function_privs_are(
  'public',
  'get_slip_analysis_quota',
  array['uuid'],
  'authenticated',
  array['EXECUTE']
);
select function_privs_are(
  'public',
  'get_slip_analysis_quota',
  array['uuid'],
  'anon',
  array[]::text[]
);
select function_privs_are(
  'public',
  'consume_slip_analysis_quota',
  array['uuid'],
  'authenticated',
  array['EXECUTE']
);
select function_privs_are(
  'public',
  'consume_slip_analysis_quota',
  array['uuid'],
  'anon',
  array[]::text[]
);
select table_privs_are(
  'public',
  'slip_analysis_attempts',
  'authenticated',
  array[]::text[]
);
select has_function(
  'public', 'confirm_financial_document_import', array['jsonb']
);
select has_function(
  'public',
  'confirm_financial_document_import_batch',
  array['jsonb']
);
select function_privs_are(
  'public',
  'confirm_financial_document_import_batch',
  array['jsonb'],
  'authenticated',
  array['EXECUTE']
);
select function_privs_are(
  'public',
  'confirm_financial_document_import_batch',
  array['jsonb'],
  'anon',
  array[]::text[]
);
select table_privs_are(
  'public',
  'financial_document_import_batches',
  'authenticated',
  array[]::text[]
);
select * from finish();
rollback;
