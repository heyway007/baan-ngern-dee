create table public.financial_document_imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.workspaces(id) on delete cascade,
  transaction_id uuid not null
    references public.transactions(id) on delete cascade,
  document_kind text not null
    check (document_kind in ('bank_transfer', 'receipt')),
  image_sha256 text not null
    check (image_sha256 ~ '^[0-9a-f]{64}$'),
  document_identity_sha256 text
    check (
      document_identity_sha256 is null
      or document_identity_sha256 ~ '^[0-9a-f]{64}$'
    ),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, image_sha256)
);

create unique index financial_document_imports_identity_unique
  on public.financial_document_imports
  (workspace_id, document_identity_sha256)
  where document_identity_sha256 is not null;

create table public.slip_analysis_attempts (
  id bigint generated always as identity primary key,
  workspace_id uuid not null
    references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default now()
);

create index slip_analysis_attempts_user_time
  on public.slip_analysis_attempts (user_id, attempted_at desc);
create index slip_analysis_attempts_workspace_time
  on public.slip_analysis_attempts (workspace_id, attempted_at desc);

alter table public.financial_document_imports enable row level security;
alter table public.slip_analysis_attempts enable row level security;

create policy financial_document_import_select_member
on public.financial_document_imports for select
using (public.is_workspace_member(workspace_id));

create function public.find_financial_document_duplicate(
  p_workspace_id uuid,
  p_image_sha256 text,
  p_document_identity_sha256 text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null
    or not public.is_workspace_member(p_workspace_id)
  then
    raise exception using errcode = '42501', message = 'workspace access denied';
  end if;

  select jsonb_build_object(
    'id', transaction.id,
    'amount', public.format_money(transaction.amount, transaction.currency),
    'financialDate', transaction.financial_date,
    'note', transaction.note
  )
  into v_result
  from public.financial_document_imports import
  join public.transactions transaction on transaction.id = import.transaction_id
  where import.workspace_id = p_workspace_id
    and (
      import.image_sha256 = p_image_sha256
      or (
        p_document_identity_sha256 is not null
        and import.document_identity_sha256 = p_document_identity_sha256
      )
    )
  order by import.created_at desc
  limit 1;
  return v_result;
end;
$$;

create function public.consume_slip_analysis_quota(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_count integer;
  v_workspace_count integer;
begin
  if v_user_id is null
    or not public.is_workspace_member(p_workspace_id)
  then
    raise exception using errcode = '42501', message = 'workspace access denied';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text));
  perform pg_advisory_xact_lock(hashtext(p_workspace_id::text));

  delete from public.slip_analysis_attempts
  where attempted_at < now() - interval '24 hours';

  select count(*) into v_user_count
  from public.slip_analysis_attempts
  where user_id = v_user_id
    and attempted_at >= now() - interval '1 hour';
  if v_user_count >= 10 then
    return jsonb_build_object('allowed', false, 'reason', 'user_hour');
  end if;

  select count(*) into v_workspace_count
  from public.slip_analysis_attempts
  where workspace_id = p_workspace_id
    and attempted_at >= (
      date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
    );
  if v_workspace_count >= 30 then
    return jsonb_build_object('allowed', false, 'reason', 'workspace_day');
  end if;

  insert into public.slip_analysis_attempts (workspace_id, user_id)
  values (p_workspace_id, v_user_id);
  return jsonb_build_object('allowed', true);
end;
$$;

create function public.confirm_financial_document_import(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid := (p_input ->> 'workspaceId')::uuid;
  v_transaction jsonb;
  v_transaction_id uuid;
  v_duplicate jsonb;
begin
  if v_user_id is null
    or coalesce(public.workspace_role_for(v_workspace_id)::text, '')
      not in ('owner', 'editor')
  then
    raise exception using errcode = '42501', message = 'workspace access denied';
  end if;

  begin
    v_transaction := public.post_transaction(p_input -> 'transaction');
    v_transaction_id := (v_transaction ->> 'transactionId')::uuid;

    insert into public.financial_document_imports (
      workspace_id,
      transaction_id,
      document_kind,
      image_sha256,
      document_identity_sha256,
      created_by
    )
    values (
      v_workspace_id,
      v_transaction_id,
      p_input ->> 'documentKind',
      p_input ->> 'imageSha256',
      nullif(p_input ->> 'documentIdentitySha256', ''),
      v_user_id
    );
  exception when unique_violation then
    v_duplicate := public.find_financial_document_duplicate(
      v_workspace_id,
      p_input ->> 'imageSha256',
      nullif(p_input ->> 'documentIdentitySha256', '')
    );
    return jsonb_build_object(
      'status', 'duplicate',
      'existingTransaction', v_duplicate
    );
  end;

  return jsonb_build_object('status', 'posted', 'transaction', v_transaction);
end;
$$;

revoke all on table public.financial_document_imports from public, anon, authenticated;
revoke all on table public.slip_analysis_attempts from public, anon, authenticated;
revoke all on function public.find_financial_document_duplicate(uuid, text, text) from public;
revoke all on function public.consume_slip_analysis_quota(uuid) from public;
revoke all on function public.confirm_financial_document_import(jsonb) from public;
grant execute on function public.find_financial_document_duplicate(uuid, text, text) to authenticated;
grant execute on function public.consume_slip_analysis_quota(uuid) to authenticated;
grant execute on function public.confirm_financial_document_import(jsonb) to authenticated;
