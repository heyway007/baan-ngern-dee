create or replace function public.get_slip_analysis_quota(
  p_workspace_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_used integer;
begin
  if auth.uid() is null
    or not public.is_workspace_member(p_workspace_id)
  then
    raise exception using errcode = '42501',
      message = 'workspace access denied';
  end if;

  select count(*) into v_used
  from public.slip_analysis_attempts
  where workspace_id = p_workspace_id
    and attempted_at >= (
      date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
    );

  return jsonb_build_object('used', v_used, 'limit', 30);
end;
$$;

create or replace function public.consume_slip_analysis_quota(
  p_workspace_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_count integer;
begin
  if v_user_id is null
    or not public.is_workspace_member(p_workspace_id)
  then
    raise exception using errcode = '42501',
      message = 'workspace access denied';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_workspace_id::text));

  delete from public.slip_analysis_attempts
  where attempted_at < now() - interval '24 hours';

  select count(*) into v_workspace_count
  from public.slip_analysis_attempts
  where workspace_id = p_workspace_id
    and attempted_at >= (
      date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
    );

  if v_workspace_count >= 30 then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'workspace_day',
      'used', 30,
      'limit', 30
    );
  end if;

  insert into public.slip_analysis_attempts (workspace_id, user_id)
  values (p_workspace_id, v_user_id);

  return jsonb_build_object(
    'allowed', true,
    'used', v_workspace_count + 1,
    'limit', 30
  );
end;
$$;

revoke all on function public.get_slip_analysis_quota(uuid)
  from public, anon, authenticated;
revoke all on function public.consume_slip_analysis_quota(uuid)
  from public, anon, authenticated;
grant execute on function public.get_slip_analysis_quota(uuid)
  to authenticated;
grant execute on function public.consume_slip_analysis_quota(uuid)
  to authenticated;

create table public.financial_document_import_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.workspaces(id) on delete cascade,
  batch_mutation_id uuid not null,
  request_sha256 text not null
    check (request_sha256 ~ '^[0-9a-f]{64}$'),
  item_count smallint not null check (item_count between 1 and 10),
  response jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (created_by, batch_mutation_id)
);

alter table public.financial_document_import_batches
  enable row level security;

alter table public.financial_document_imports
  add column batch_id uuid
    references public.financial_document_import_batches(id)
      on delete cascade,
  add column batch_item_id uuid,
  add column batch_position smallint
    check (batch_position between 0 and 9),
  add check (
    (batch_id is null and batch_item_id is null and batch_position is null)
    or
    (batch_id is not null and batch_item_id is not null
      and batch_position is not null)
  );

create unique index financial_document_import_batch_item
  on public.financial_document_imports(batch_id, batch_item_id)
  where batch_id is not null;

create unique index financial_document_import_batch_position
  on public.financial_document_imports(batch_id, batch_position)
  where batch_id is not null;

create function public.confirm_financial_document_import_batch(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid := (p_input ->> 'workspaceId')::uuid;
  v_batch_mutation_id uuid := (p_input ->> 'batchMutationId')::uuid;
  v_request_sha256 text := p_input ->> 'requestSha256';
  v_items jsonb := p_input -> 'items';
  v_item_count integer;
  v_existing public.financial_document_import_batches%rowtype;
  v_batch_id uuid;
  v_item jsonb;
  v_item_id uuid;
  v_transaction_input jsonb;
  v_transaction jsonb;
  v_account_currency text;
  v_issue_code text;
  v_issues jsonb := '[]'::jsonb;
  v_response jsonb := jsonb_build_object(
    'status', 'posted',
    'items', '[]'::jsonb
  );
  v_position integer;
  v_constraint_name text;
  v_seen_item_ids uuid[] := array[]::uuid[];
  v_seen_mutation_ids uuid[] := array[]::uuid[];
begin
  if v_user_id is null
    or coalesce(public.workspace_role_for(v_workspace_id)::text, '')
      not in ('owner', 'editor')
  then
    raise exception using errcode = '42501',
      message = 'workspace access denied';
  end if;

  if jsonb_typeof(v_items) <> 'array' then
    raise exception using errcode = '22023',
      message = 'invalid batch items';
  end if;
  v_item_count := jsonb_array_length(v_items);
  if v_item_count not between 1 and 10
    or v_request_sha256 !~ '^[0-9a-f]{64}$'
  then
    raise exception using errcode = '22023',
      message = 'invalid batch metadata';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(v_user_id::text),
    hashtext(v_batch_mutation_id::text)
  );

  select * into v_existing
  from public.financial_document_import_batches
  where created_by = v_user_id
    and batch_mutation_id = v_batch_mutation_id;

  if found then
    if v_existing.workspace_id <> v_workspace_id
      or v_existing.request_sha256 <> v_request_sha256
      or v_existing.response is null
    then
      return jsonb_build_object(
        'status', 'blocked',
        'issues', jsonb_build_array(jsonb_build_object(
          'itemId', (v_items -> 0 ->> 'itemId')::uuid,
          'code', 'mutation_conflict'
        ))
      );
    end if;
    return v_existing.response;
  end if;

  for v_item in
    select value from jsonb_array_elements(v_items)
  loop
    v_item_id := (v_item ->> 'itemId')::uuid;
    v_transaction_input := v_item -> 'transaction';
    v_issue_code := null;

    if v_item_id = any(v_seen_item_ids)
      or (v_transaction_input ->> 'clientMutationId')::uuid =
        any(v_seen_mutation_ids)
      or v_item ->> 'imageSha256' !~ '^[0-9a-f]{64}$'
      or (
        nullif(v_item ->> 'documentIdentitySha256', '') is not null
        and nullif(v_item ->> 'documentIdentitySha256', '')
          !~ '^[0-9a-f]{64}$'
      )
      or v_item ->> 'documentKind' not in ('bank_transfer', 'receipt')
      or v_transaction_input ->> 'workspaceId' <> v_workspace_id::text
      or v_transaction_input ->> 'type' not in ('income', 'expense')
    then
      v_issue_code := 'invalid_analysis';
    elsif exists (
      select 1
      from public.financial_document_imports import
      where import.workspace_id = v_workspace_id
        and (
          import.image_sha256 = v_item ->> 'imageSha256'
          or (
            nullif(v_item ->> 'documentIdentitySha256', '') is not null
            and import.document_identity_sha256 =
              nullif(v_item ->> 'documentIdentitySha256', '')
          )
        )
    ) then
      v_issue_code := 'duplicate';
    else
      select account.currency into v_account_currency
      from public.accounts account
      where account.id =
          (v_transaction_input ->> 'accountId')::uuid
        and account.workspace_id = v_workspace_id
        and account.archived_at is null;

      if not found then
        v_issue_code := 'invalid_account';
      elsif v_account_currency <> v_transaction_input ->> 'currency' then
        v_issue_code := 'currency_mismatch';
      elsif v_transaction_input ? 'splits' and (
        jsonb_typeof(v_transaction_input -> 'splits') <> 'array'
        or jsonb_array_length(v_transaction_input -> 'splits') = 0
        or exists (
          select 1
          from jsonb_array_elements(
            v_transaction_input -> 'splits'
          ) split
          where not exists (
            select 1
            from public.categories category
            where category.id = (split ->> 'categoryId')::uuid
              and category.workspace_id = v_workspace_id
              and category.kind::text =
                v_transaction_input ->> 'type'
              and category.archived_at is null
          )
        )
      ) then
        v_issue_code := 'invalid_category';
      elsif not (v_transaction_input ? 'splits')
        and not exists (
          select 1
          from public.categories category
          where category.id =
              (v_transaction_input ->> 'categoryId')::uuid
            and category.workspace_id = v_workspace_id
            and category.kind::text =
              v_transaction_input ->> 'type'
            and category.archived_at is null
        )
      then
        v_issue_code := 'invalid_category';
      elsif exists (
        select 1
        from public.transactions transaction
        where transaction.created_by = v_user_id
          and transaction.client_mutation_id =
            (v_transaction_input ->> 'clientMutationId')::uuid
      ) then
        v_issue_code := 'mutation_conflict';
      end if;
    end if;

    v_seen_item_ids := array_append(v_seen_item_ids, v_item_id);
    v_seen_mutation_ids := array_append(
      v_seen_mutation_ids,
      (v_transaction_input ->> 'clientMutationId')::uuid
    );
    if v_issue_code is not null then
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'itemId', v_item_id,
        'code', v_issue_code
      ));
    end if;
  end loop;

  if jsonb_array_length(v_issues) > 0 then
    return jsonb_build_object('status', 'blocked', 'issues', v_issues);
  end if;

  begin
    insert into public.financial_document_import_batches (
      workspace_id,
      batch_mutation_id,
      request_sha256,
      item_count,
      created_by
    )
    values (
      v_workspace_id,
      v_batch_mutation_id,
      v_request_sha256,
      v_item_count,
      v_user_id
    )
    returning id into v_batch_id;

    for v_item, v_position in
      select
        element.value,
        element.ordinality::integer - 1
      from jsonb_array_elements(v_items)
        with ordinality as element(value, ordinality)
    loop
      v_item_id := (v_item ->> 'itemId')::uuid;
      v_transaction_input := v_item -> 'transaction';
      v_transaction := public.post_transaction(v_transaction_input);

      insert into public.financial_document_imports (
        workspace_id,
        transaction_id,
        document_kind,
        image_sha256,
        document_identity_sha256,
        created_by,
        batch_id,
        batch_item_id,
        batch_position
      )
      values (
        v_workspace_id,
        (v_transaction ->> 'transactionId')::uuid,
        v_item ->> 'documentKind',
        v_item ->> 'imageSha256',
        nullif(v_item ->> 'documentIdentitySha256', ''),
        v_user_id,
        v_batch_id,
        v_item_id,
        v_position
      );

      v_response := jsonb_set(
        v_response,
        '{items}',
        (v_response -> 'items') || jsonb_build_array(
          jsonb_build_object(
            'itemId', v_item_id,
            'transaction', v_transaction
          )
        )
      );
    end loop;

    update public.financial_document_import_batches
    set response = v_response
    where id = v_batch_id;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name in (
        'financial_document_imports_workspace_id_image_sha256_key',
        'financial_document_imports_identity_unique'
      ) then
        return jsonb_build_object(
          'status', 'blocked',
          'issues', jsonb_build_array(jsonb_build_object(
            'itemId', v_item_id,
            'code', 'duplicate'
          ))
        );
      elsif v_constraint_name =
        'transactions_created_by_client_mutation_id_key'
      then
        return jsonb_build_object(
          'status', 'blocked',
          'issues', jsonb_build_array(jsonb_build_object(
            'itemId', v_item_id,
            'code', 'mutation_conflict'
          ))
        );
      end if;
      raise;
    when sqlstate '22023' then
      return jsonb_build_object(
        'status', 'blocked',
        'issues', jsonb_build_array(jsonb_build_object(
          'itemId', v_item_id,
          'code', 'invalid_analysis'
        ))
      );
  end;

  return v_response;
end;
$$;

revoke all on table public.financial_document_import_batches
  from public, anon, authenticated;
revoke all on function public.confirm_financial_document_import_batch(jsonb)
  from public, anon, authenticated;
grant execute on function public.confirm_financial_document_import_batch(jsonb)
  to authenticated;
