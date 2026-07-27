create type public.recurring_template_status as enum (
  'active',
  'paused',
  'cancelled'
);

create type public.recurring_occurrence_status as enum (
  'pending',
  'posted',
  'skipped'
);

create table public.recurring_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.workspaces (id) on delete cascade,
  name text not null
    check (char_length(btrim(name)) between 1 and 100),
  kind public.category_kind not null,
  amount numeric(20, 4) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  account_id uuid not null references public.accounts (id),
  category_id uuid not null references public.categories (id),
  day_of_month integer not null check (day_of_month between 1 and 31),
  start_month date not null
    check (date_trunc('month', start_month)::date = start_month),
  end_month date
    check (
      end_month is null
      or (
        date_trunc('month', end_month)::date = end_month
        and end_month >= start_month
      )
    ),
  status public.recurring_template_status not null default 'active',
  version integer not null default 1 check (version > 0),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index recurring_template_workspace_status
  on public.recurring_templates (workspace_id, status, start_month);

create table public.recurring_occurrences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.workspaces (id) on delete cascade,
  template_id uuid not null references public.recurring_templates (id),
  kind public.category_kind not null,
  period_month date not null
    check (date_trunc('month', period_month)::date = period_month),
  scheduled_date date not null,
  amount numeric(20, 4) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  account_id uuid not null references public.accounts (id),
  category_id uuid not null references public.categories (id),
  status public.recurring_occurrence_status not null default 'pending',
  transaction_id uuid unique references public.transactions (id),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_id, period_month),
  check (date_trunc('month', scheduled_date)::date = period_month),
  check (
    (status = 'posted' and transaction_id is not null)
    or (
      status in ('pending', 'skipped')
      and transaction_id is null
    )
  )
);

create index recurring_occurrence_workspace_period
  on public.recurring_occurrences (
    workspace_id,
    period_month,
    scheduled_date
  );

alter table public.recurring_templates enable row level security;
alter table public.recurring_occurrences enable row level security;

create policy recurring_template_select_member
on public.recurring_templates for select
using (public.is_workspace_member(workspace_id));

create policy recurring_occurrence_select_member
on public.recurring_occurrences for select
using (public.is_workspace_member(workspace_id));

create function public.recurring_month(p_period text)
returns date
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  if p_period is null
    or p_period !~ '^\d{4}-(0[1-9]|1[0-2])$'
  then
    raise exception using
      errcode = '22023',
      message = 'invalid recurring period';
  end if;
  return (p_period || '-01')::date;
end;
$$;

create function public.recurring_date(
  p_period date,
  p_day integer
)
returns date
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  if p_period is null
    or date_trunc('month', p_period)::date <> p_period
    or p_day not between 1 and 31
  then
    raise exception using
      errcode = '22023',
      message = 'invalid recurring date';
  end if;

  return make_date(
    extract(year from p_period)::integer,
    extract(month from p_period)::integer,
    least(
      p_day,
      extract(
        day from (
          date_trunc('month', p_period)
          + interval '1 month - 1 day'
        )
      )::integer
    )
  );
end;
$$;

create function public.recurring_template_json(p_id uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_strip_nulls(
    jsonb_build_object(
      'id', template.id,
      'workspaceId', template.workspace_id,
      'name', template.name,
      'kind', template.kind,
      'amount', public.format_money(
        template.amount,
        template.currency
      ),
      'currency', template.currency,
      'accountId', template.account_id,
      'categoryId', template.category_id,
      'dayOfMonth', template.day_of_month,
      'startMonth', to_char(template.start_month, 'YYYY-MM'),
      'endMonth', case
        when template.end_month is null then null
        else to_char(template.end_month, 'YYYY-MM')
      end,
      'status', template.status,
      'version', template.version
    )
  )
  from public.recurring_templates template
  where template.id = p_id
$$;

create function public.recurring_occurrence_json(p_id uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_strip_nulls(
    jsonb_build_object(
      'id', occurrence.id,
      'workspaceId', occurrence.workspace_id,
      'templateId', occurrence.template_id,
      'name', template.name,
      'kind', occurrence.kind,
      'period', to_char(occurrence.period_month, 'YYYY-MM'),
      'scheduledDate', to_char(
        occurrence.scheduled_date,
        'YYYY-MM-DD'
      ),
      'amount', public.format_money(
        occurrence.amount,
        occurrence.currency
      ),
      'currency', occurrence.currency,
      'accountId', occurrence.account_id,
      'categoryId', occurrence.category_id,
      'status', occurrence.status,
      'transactionId', occurrence.transaction_id,
      'version', occurrence.version
    )
  )
  from public.recurring_occurrences occurrence
  join public.recurring_templates template
    on template.id = occurrence.template_id
  where occurrence.id = p_id
$$;

create function public.create_recurring_template(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid := (p_input ->> 'workspaceId')::uuid;
  v_name text := btrim(p_input ->> 'name');
  v_kind public.category_kind :=
    (p_input ->> 'kind')::public.category_kind;
  v_amount numeric(20, 4) := (p_input ->> 'amount')::numeric;
  v_currency text := p_input ->> 'currency';
  v_account_id uuid := (p_input ->> 'accountId')::uuid;
  v_category_id uuid := (p_input ->> 'categoryId')::uuid;
  v_day integer := (p_input ->> 'dayOfMonth')::integer;
  v_start date := public.recurring_month(p_input ->> 'startMonth');
  v_end date := case
    when nullif(p_input ->> 'endMonth', '') is null then null
    else public.recurring_month(p_input ->> 'endMonth')
  end;
  v_id uuid;
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'authentication required';
  end if;
  if coalesce(
    public.workspace_role_for(v_workspace_id)::text,
    ''
  ) not in ('owner', 'editor') then
    raise exception using
      errcode = '42501',
      message = 'workspace access denied';
  end if;
  if v_name is null
    or char_length(v_name) not between 1 and 100
    or v_amount <= 0
    or v_currency !~ '^[A-Z]{3}$'
    or v_day not between 1 and 31
    or (v_end is not null and v_end < v_start)
  then
    raise exception using
      errcode = '22023',
      message = 'invalid recurring template';
  end if;
  if not exists (
    select 1
    from public.accounts account
    where account.id = v_account_id
      and account.workspace_id = v_workspace_id
      and account.currency = v_currency
      and account.archived_at is null
  ) or not exists (
    select 1
    from public.categories category
    where category.id = v_category_id
      and category.workspace_id = v_workspace_id
      and category.kind = v_kind
      and category.archived_at is null
  ) then
    raise exception using
      errcode = '22023',
      message = 'invalid recurring destination';
  end if;

  insert into public.recurring_templates (
    workspace_id,
    name,
    kind,
    amount,
    currency,
    account_id,
    category_id,
    day_of_month,
    start_month,
    end_month,
    created_by
  )
  values (
    v_workspace_id,
    v_name,
    v_kind,
    v_amount,
    v_currency,
    v_account_id,
    v_category_id,
    v_day,
    v_start,
    v_end,
    v_user_id
  )
  returning id into v_id;

  insert into public.audit_events (
    workspace_id,
    actor_user_id,
    action,
    entity_type,
    entity_id
  )
  values (
    v_workspace_id,
    v_user_id,
    'recurring_template.created',
    'recurring_template',
    v_id
  );

  return public.recurring_template_json(v_id);
end;
$$;

create function public.update_recurring_template(
  p_id uuid,
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_template public.recurring_templates%rowtype;
  v_workspace public.workspaces%rowtype;
  v_expected_version integer :=
    (p_input ->> 'version')::integer;
  v_name text := btrim(p_input ->> 'name');
  v_kind public.category_kind :=
    (p_input ->> 'kind')::public.category_kind;
  v_amount numeric(20, 4) := (p_input ->> 'amount')::numeric;
  v_currency text := p_input ->> 'currency';
  v_account_id uuid := (p_input ->> 'accountId')::uuid;
  v_category_id uuid := (p_input ->> 'categoryId')::uuid;
  v_day integer := (p_input ->> 'dayOfMonth')::integer;
  v_start date := public.recurring_month(p_input ->> 'startMonth');
  v_end date := case
    when nullif(p_input ->> 'endMonth', '') is null then null
    else public.recurring_month(p_input ->> 'endMonth')
  end;
  v_current_period date;
begin
  select * into v_template
  from public.recurring_templates
  where id = p_id
  for update;
  if not found
    or v_user_id is null
    or coalesce(
      public.workspace_role_for(v_template.workspace_id)::text,
      ''
    ) not in ('owner', 'editor')
  then
    raise exception using
      errcode = '42501',
      message = 'workspace access denied';
  end if;
  if v_template.version <> v_expected_version
    or v_template.status = 'cancelled'
  then
    raise exception using
      errcode = '40001',
      message = 'stale version';
  end if;
  if v_name is null
    or char_length(v_name) not between 1 and 100
    or v_amount <= 0
    or v_currency !~ '^[A-Z]{3}$'
    or v_day not between 1 and 31
    or (v_end is not null and v_end < v_start)
  then
    raise exception using
      errcode = '22023',
      message = 'invalid recurring template';
  end if;
  if not exists (
    select 1
    from public.accounts account
    where account.id = v_account_id
      and account.workspace_id = v_template.workspace_id
      and account.currency = v_currency
      and account.archived_at is null
  ) or not exists (
    select 1
    from public.categories category
    where category.id = v_category_id
      and category.workspace_id = v_template.workspace_id
      and category.kind = v_kind
      and category.archived_at is null
  ) then
    raise exception using
      errcode = '22023',
      message = 'invalid recurring destination';
  end if;

  select * into v_workspace
  from public.workspaces
  where id = v_template.workspace_id
    and archived_at is null;
  v_current_period :=
    date_trunc('month', now() at time zone v_workspace.timezone)::date;

  update public.recurring_templates
  set
    name = v_name,
    kind = v_kind,
    amount = v_amount,
    currency = v_currency,
    account_id = v_account_id,
    category_id = v_category_id,
    day_of_month = v_day,
    start_month = v_start,
    end_month = v_end,
    version = version + 1,
    updated_at = now()
  where id = p_id;

  update public.recurring_occurrences
  set
    kind = v_kind,
    amount = v_amount,
    currency = v_currency,
    account_id = v_account_id,
    category_id = v_category_id,
    scheduled_date = public.recurring_date(
      v_current_period,
      v_day
    ),
    version = version + 1,
    updated_at = now()
  where template_id = p_id
    and period_month = v_current_period
    and status = 'pending';

  insert into public.audit_events (
    workspace_id,
    actor_user_id,
    action,
    entity_type,
    entity_id
  )
  values (
    v_template.workspace_id,
    v_user_id,
    'recurring_template.updated',
    'recurring_template',
    p_id
  );

  return public.recurring_template_json(p_id);
end;
$$;

create function public.set_recurring_template_status(
  p_id uuid,
  p_expected_version integer,
  p_status public.recurring_template_status
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_template public.recurring_templates%rowtype;
  v_allowed boolean;
begin
  select * into v_template
  from public.recurring_templates
  where id = p_id
  for update;
  if not found
    or v_user_id is null
    or coalesce(
      public.workspace_role_for(v_template.workspace_id)::text,
      ''
    ) not in ('owner', 'editor')
  then
    raise exception using
      errcode = '42501',
      message = 'workspace access denied';
  end if;

  v_allowed :=
    (v_template.status = 'active' and p_status = 'paused')
    or (v_template.status = 'paused' and p_status = 'active')
    or (
      v_template.status in ('active', 'paused')
      and p_status = 'cancelled'
    );
  if v_template.version <> p_expected_version or not v_allowed then
    raise exception using
      errcode = '40001',
      message = 'stale version or invalid status transition';
  end if;

  update public.recurring_templates
  set
    status = p_status,
    version = version + 1,
    updated_at = now()
  where id = p_id;

  insert into public.audit_events (
    workspace_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    safe_metadata
  )
  values (
    v_template.workspace_id,
    v_user_id,
    'recurring_template.status_changed',
    'recurring_template',
    p_id,
    jsonb_build_object('status', p_status)
  );

  return public.recurring_template_json(p_id);
end;
$$;

create function public.materialize_recurring_period(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid := (p_input ->> 'workspaceId')::uuid;
  v_period date := public.recurring_month(p_input ->> 'period');
  v_workspace public.workspaces%rowtype;
  v_current_period date;
  v_eligible_count integer;
  v_created_count integer;
begin
  select * into v_workspace
  from public.workspaces
  where id = v_workspace_id
    and archived_at is null;
  if not found
    or v_user_id is null
    or coalesce(
      public.workspace_role_for(v_workspace_id)::text,
      ''
    ) not in ('owner', 'editor')
  then
    raise exception using
      errcode = '42501',
      message = 'workspace access denied';
  end if;

  v_current_period :=
    date_trunc('month', now() at time zone v_workspace.timezone)::date;
  if v_period <> v_current_period then
    raise exception using
      errcode = '22023',
      message = 'recurring period must be current month';
  end if;

  select count(*)::integer into v_eligible_count
  from public.recurring_templates template
  where template.workspace_id = v_workspace_id
    and template.status = 'active'
    and template.start_month <= v_period
    and (
      template.end_month is null
      or template.end_month >= v_period
    );

  insert into public.recurring_occurrences (
    workspace_id,
    template_id,
    kind,
    period_month,
    scheduled_date,
    amount,
    currency,
    account_id,
    category_id
  )
  select
    template.workspace_id,
    template.id,
    template.kind,
    v_period,
    public.recurring_date(v_period, template.day_of_month),
    template.amount,
    template.currency,
    template.account_id,
    template.category_id
  from public.recurring_templates template
  where template.workspace_id = v_workspace_id
    and template.status = 'active'
    and template.start_month <= v_period
    and (
      template.end_month is null
      or template.end_month >= v_period
    )
  on conflict (template_id, period_month) do nothing;
  get diagnostics v_created_count = row_count;

  return jsonb_build_object(
    'createdCount', v_created_count,
    'existingCount', v_eligible_count - v_created_count
  );
end;
$$;

create function public.get_recurring_period(
  p_workspace_id uuid,
  p_period text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period date := public.recurring_month(p_period);
  v_occurrences jsonb;
begin
  if auth.uid() is null
    or not public.is_workspace_member(p_workspace_id)
  then
    raise exception using
      errcode = '42501',
      message = 'workspace access denied';
  end if;

  select coalesce(
    jsonb_agg(
      public.recurring_occurrence_json(occurrence.id)
      order by occurrence.scheduled_date, template.name
    ),
    '[]'::jsonb
  )
  into v_occurrences
  from public.recurring_occurrences occurrence
  join public.recurring_templates template
    on template.id = occurrence.template_id
  where occurrence.workspace_id = p_workspace_id
    and occurrence.period_month = v_period;

  return jsonb_build_object(
    'period', p_period,
    'occurrences', v_occurrences
  );
end;
$$;

create function public.update_recurring_occurrence(
  p_id uuid,
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_occurrence public.recurring_occurrences%rowtype;
  v_expected_version integer :=
    (p_input ->> 'version')::integer;
  v_amount numeric(20, 4) := (p_input ->> 'amount')::numeric;
  v_scheduled_date date := (p_input ->> 'scheduledDate')::date;
begin
  select * into v_occurrence
  from public.recurring_occurrences
  where id = p_id
  for update;
  if not found
    or v_user_id is null
    or coalesce(
      public.workspace_role_for(v_occurrence.workspace_id)::text,
      ''
    ) not in ('owner', 'editor')
  then
    raise exception using
      errcode = '42501',
      message = 'workspace access denied';
  end if;
  if v_occurrence.version <> v_expected_version
    or v_occurrence.status <> 'pending'
  then
    raise exception using
      errcode = '40001',
      message = 'stale version';
  end if;
  if v_amount <= 0
    or date_trunc('month', v_scheduled_date)::date
      <> v_occurrence.period_month
  then
    raise exception using
      errcode = '22023',
      message = 'invalid recurring occurrence';
  end if;

  update public.recurring_occurrences
  set
    amount = v_amount,
    scheduled_date = v_scheduled_date,
    version = version + 1,
    updated_at = now()
  where id = p_id;

  return public.recurring_occurrence_json(p_id);
end;
$$;

create function public.skip_recurring_occurrence(
  p_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_occurrence public.recurring_occurrences%rowtype;
begin
  select * into v_occurrence
  from public.recurring_occurrences
  where id = p_id
  for update;
  if not found
    or v_user_id is null
    or coalesce(
      public.workspace_role_for(v_occurrence.workspace_id)::text,
      ''
    ) not in ('owner', 'editor')
  then
    raise exception using
      errcode = '42501',
      message = 'workspace access denied';
  end if;
  if v_occurrence.version <> p_expected_version
    or v_occurrence.status <> 'pending'
  then
    raise exception using
      errcode = '40001',
      message = 'stale version';
  end if;

  update public.recurring_occurrences
  set
    status = 'skipped',
    version = version + 1,
    updated_at = now()
  where id = p_id;

  insert into public.audit_events (
    workspace_id,
    actor_user_id,
    action,
    entity_type,
    entity_id
  )
  values (
    v_occurrence.workspace_id,
    v_user_id,
    'recurring_occurrence.skipped',
    'recurring_occurrence',
    p_id
  );

  return public.recurring_occurrence_json(p_id);
end;
$$;

create function public.post_recurring_occurrence(
  p_id uuid,
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_expected_version integer :=
    (p_input ->> 'version')::integer;
  v_mutation_id uuid :=
    (p_input ->> 'clientMutationId')::uuid;
  v_occurrence public.recurring_occurrences%rowtype;
  v_existing_transaction_id uuid;
  v_transaction jsonb;
  v_transaction_id uuid;
begin
  select * into v_occurrence
  from public.recurring_occurrences
  where id = p_id
  for update;
  if not found
    or v_user_id is null
    or coalesce(
      public.workspace_role_for(v_occurrence.workspace_id)::text,
      ''
    ) not in ('owner', 'editor')
  then
    raise exception using
      errcode = '42501',
      message = 'workspace access denied';
  end if;

  select id into v_existing_transaction_id
  from public.transactions
  where created_by = v_user_id
    and client_mutation_id = v_mutation_id;
  if found then
    if v_occurrence.status = 'posted'
      and v_occurrence.transaction_id = v_existing_transaction_id
    then
      return jsonb_build_object(
        'response', jsonb_build_object(
          'occurrence', public.recurring_occurrence_json(p_id),
          'transaction',
            public.transaction_response(v_existing_transaction_id)
        ),
        'replayed', true
      );
    end if;
    raise exception using
      errcode = '23505',
      message = 'duplicate mutation for another occurrence';
  end if;

  if v_occurrence.version <> v_expected_version
    or v_occurrence.status <> 'pending'
  then
    raise exception using
      errcode = '40001',
      message = 'stale version';
  end if;

  v_transaction := public.post_transaction(
    jsonb_build_object(
      'workspaceId', v_occurrence.workspace_id,
      'accountId', v_occurrence.account_id,
      'type', v_occurrence.kind,
      'amount', public.format_money(
        v_occurrence.amount,
        v_occurrence.currency
      ),
      'currency', v_occurrence.currency,
      'financialDate', to_char(
        v_occurrence.scheduled_date,
        'YYYY-MM-DD'
      ),
      'categoryId', v_occurrence.category_id,
      'note', 'รายการประจำ',
      'tagIds', jsonb_build_array(),
      'clientMutationId', v_mutation_id
    )
  );
  v_transaction_id := (v_transaction ->> 'transactionId')::uuid;

  update public.recurring_occurrences
  set
    status = 'posted',
    transaction_id = v_transaction_id,
    version = version + 1,
    updated_at = now()
  where id = p_id;

  insert into public.audit_events (
    workspace_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    safe_metadata
  )
  values (
    v_occurrence.workspace_id,
    v_user_id,
    'recurring_occurrence.posted',
    'recurring_occurrence',
    p_id,
    jsonb_build_object('transactionId', v_transaction_id)
  );

  return jsonb_build_object(
    'response', jsonb_build_object(
      'occurrence', public.recurring_occurrence_json(p_id),
      'transaction', v_transaction
    ),
    'replayed', false
  );
end;
$$;

revoke all on function public.recurring_month(text) from public;
revoke all on function public.recurring_date(date, integer) from public;
revoke all on function public.recurring_template_json(uuid) from public;
revoke all on function public.recurring_occurrence_json(uuid) from public;
revoke all on function public.create_recurring_template(jsonb) from public;
revoke all on function public.update_recurring_template(uuid, jsonb)
  from public;
revoke all on function public.set_recurring_template_status(
  uuid,
  integer,
  public.recurring_template_status
) from public;
revoke all on function public.materialize_recurring_period(jsonb)
  from public;
revoke all on function public.get_recurring_period(uuid, text)
  from public;
revoke all on function public.update_recurring_occurrence(uuid, jsonb)
  from public;
revoke all on function public.skip_recurring_occurrence(uuid, integer)
  from public;
revoke all on function public.post_recurring_occurrence(uuid, jsonb)
  from public;

grant select on public.recurring_templates to authenticated;
grant select on public.recurring_occurrences to authenticated;
grant execute on function public.create_recurring_template(jsonb)
  to authenticated;
grant execute on function public.update_recurring_template(uuid, jsonb)
  to authenticated;
grant execute on function public.set_recurring_template_status(
  uuid,
  integer,
  public.recurring_template_status
) to authenticated;
grant execute on function public.materialize_recurring_period(jsonb)
  to authenticated;
grant execute on function public.get_recurring_period(uuid, text)
  to authenticated;
grant execute on function public.update_recurring_occurrence(uuid, jsonb)
  to authenticated;
grant execute on function public.skip_recurring_occurrence(uuid, integer)
  to authenticated;
grant execute on function public.post_recurring_occurrence(uuid, jsonb)
  to authenticated;
