create type public.transaction_type as enum (
  'income',
  'expense',
  'balance_adjustment'
);
create type public.transaction_state as enum ('posted', 'void');

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.workspaces (id) on delete cascade,
  account_id uuid not null references public.accounts (id),
  category_id uuid references public.categories (id),
  merchant_id uuid references public.merchants (id),
  type public.transaction_type not null,
  amount numeric(20, 4) not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  base_amount numeric(20, 4) not null,
  base_currency text not null check (base_currency ~ '^[A-Z]{3}$'),
  exchange_rate numeric(20, 10) not null default 1
    check (exchange_rate > 0),
  financial_date date not null,
  note text check (note is null or char_length(note) <= 500),
  state public.transaction_state not null default 'posted',
  client_mutation_id uuid not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users (id),
  void_reason text
    check (void_reason is null or char_length(void_reason) between 1 and 200),
  version integer not null default 1 check (version > 0),
  check (
    (type in ('income', 'expense') and amount > 0)
    or (type = 'balance_adjustment' and amount <> 0)
  ),
  unique (created_by, client_mutation_id)
);

create index transaction_workspace_date
  on public.transactions (workspace_id, financial_date desc);
create index transaction_account_state
  on public.transactions (account_id, state, financial_date desc);

create table public.transaction_splits (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null
    references public.transactions (id) on delete cascade,
  category_id uuid not null references public.categories (id),
  amount numeric(20, 4) not null check (amount > 0),
  note text check (note is null or char_length(note) <= 200),
  position smallint not null check (position >= 0),
  unique (transaction_id, position)
);

create table public.transaction_tags (
  transaction_id uuid not null
    references public.transactions (id) on delete cascade,
  tag_id uuid not null references public.tags (id),
  primary key (transaction_id, tag_id)
);

alter table public.transactions enable row level security;
alter table public.transaction_splits enable row level security;
alter table public.transaction_tags enable row level security;

create policy transaction_select_member
on public.transactions for select
using (public.is_workspace_member(workspace_id));

create policy transaction_split_select_member
on public.transaction_splits for select
using (
  exists (
    select 1
    from public.transactions transaction
    where transaction.id = transaction_id
      and public.is_workspace_member(transaction.workspace_id)
  )
);

create policy transaction_tag_select_member
on public.transaction_tags for select
using (
  exists (
    select 1
    from public.transactions transaction
    where transaction.id = transaction_id
      and public.is_workspace_member(transaction.workspace_id)
  )
);

create function public.format_money(
  p_amount numeric,
  p_currency text
)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_currency in ('JPY', 'KRW', 'VND', 'CLP', 'ISK')
      then to_char(p_amount, 'FM9999999999999990')
    when p_currency in ('BHD', 'KWD', 'OMR', 'JOD', 'TND', 'LYD')
      then to_char(p_amount, 'FM9999999999999990.000')
    when p_currency = 'CLF'
      then to_char(p_amount, 'FM9999999999999990.0000')
    else to_char(p_amount, 'FM9999999999999990.00')
  end
$$;

create view public.account_balances
with (security_invoker = true)
as
select
  account.workspace_id,
  account.id as account_id,
  account.currency,
  coalesce(
    sum(
      case
        when transaction.type = 'balance_adjustment'
          then transaction.amount
        when account.type in ('credit_card', 'loan')
          and transaction.type = 'expense'
          then transaction.amount
        when account.type in ('credit_card', 'loan')
          and transaction.type = 'income'
          then -transaction.amount
        when transaction.type = 'income'
          then transaction.amount
        when transaction.type = 'expense'
          then -transaction.amount
        else 0
      end
    ),
    0
  )::numeric(20, 4) as amount
from public.accounts account
left join public.transactions transaction
  on transaction.account_id = account.id
  and transaction.state = 'posted'
group by account.workspace_id, account.id, account.currency;

create function public.transaction_response(
  p_transaction_id uuid
)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'transactionId', transaction.id,
    'version', transaction.version,
    'state', transaction.state,
    'accountBalances', jsonb_build_array(
      jsonb_build_object(
        'accountId', balance.account_id,
        'amount', public.format_money(balance.amount, balance.currency),
        'currency', balance.currency
      )
    )
  )
  from public.transactions transaction
  join public.account_balances balance
    on balance.account_id = transaction.account_id
  where transaction.id = p_transaction_id
$$;

create function public.post_transaction(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid := (p_input ->> 'workspaceId')::uuid;
  v_account_id uuid := (p_input ->> 'accountId')::uuid;
  v_type public.transaction_type :=
    (p_input ->> 'type')::public.transaction_type;
  v_amount numeric(20, 4) := (p_input ->> 'amount')::numeric;
  v_currency text := p_input ->> 'currency';
  v_financial_date date := (p_input ->> 'financialDate')::date;
  v_mutation_id uuid := (p_input ->> 'clientMutationId')::uuid;
  v_category_id uuid;
  v_merchant_id uuid;
  v_account public.accounts%rowtype;
  v_workspace public.workspaces%rowtype;
  v_transaction_id uuid;
  v_existing_id uuid;
  v_split jsonb;
  v_split_total numeric(20, 4) := 0;
  v_position smallint := 0;
  v_tag jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if v_type not in ('income', 'expense') or v_amount <= 0 then
    raise exception using errcode = '22023', message = 'invalid transaction';
  end if;

  select * into v_account
  from public.accounts
  where id = v_account_id
    and workspace_id = v_workspace_id
    and archived_at is null
  for update;
  if not found
    or public.workspace_role_for(v_workspace_id) not in ('owner', 'editor')
  then
    raise exception using errcode = '42501', message = 'workspace access denied';
  end if;
  if v_account.currency <> v_currency then
    raise exception using errcode = '22023', message = 'currency mismatch';
  end if;

  select * into v_workspace
  from public.workspaces
  where id = v_workspace_id and archived_at is null;

  select id into v_existing_id
  from public.transactions
  where created_by = v_user_id
    and client_mutation_id = v_mutation_id;
  if found then
    return public.transaction_response(v_existing_id);
  end if;

  if p_input ? 'merchantId' then
    v_merchant_id := (p_input ->> 'merchantId')::uuid;
    if not exists (
      select 1 from public.merchants
      where id = v_merchant_id
        and workspace_id = v_workspace_id
        and archived_at is null
    ) then
      raise exception using errcode = '22023', message = 'invalid merchant';
    end if;
  end if;

  if p_input ? 'splits' then
    if jsonb_typeof(p_input -> 'splits') <> 'array'
      or jsonb_array_length(p_input -> 'splits') = 0
    then
      raise exception using errcode = '22023', message = 'invalid splits';
    end if;
    for v_split in
      select value from jsonb_array_elements(p_input -> 'splits')
    loop
      v_category_id := (v_split ->> 'categoryId')::uuid;
      if not exists (
        select 1 from public.categories
        where id = v_category_id
          and workspace_id = v_workspace_id
          and kind::text = v_type::text
          and archived_at is null
      ) then
        raise exception using errcode = '22023', message = 'invalid category';
      end if;
      if (v_split ->> 'amount')::numeric <= 0 then
        raise exception using errcode = '22023', message = 'invalid split amount';
      end if;
      v_split_total :=
        v_split_total + (v_split ->> 'amount')::numeric;
    end loop;
    if v_split_total <> v_amount then
      raise exception using errcode = '22023', message = 'split total mismatch';
    end if;
  else
    v_category_id := (p_input ->> 'categoryId')::uuid;
    if not exists (
      select 1 from public.categories
      where id = v_category_id
        and workspace_id = v_workspace_id
        and kind::text = v_type::text
        and archived_at is null
    ) then
      raise exception using errcode = '22023', message = 'invalid category';
    end if;
  end if;

  if p_input ? 'tagIds' then
    for v_tag in
      select value from jsonb_array_elements(p_input -> 'tagIds')
    loop
      if not exists (
        select 1 from public.tags
        where id = (v_tag #>> '{}')::uuid
          and workspace_id = v_workspace_id
          and archived_at is null
      ) then
        raise exception using errcode = '22023', message = 'invalid tag';
      end if;
    end loop;
  end if;

  insert into public.transactions (
    workspace_id,
    account_id,
    category_id,
    merchant_id,
    type,
    amount,
    currency,
    base_amount,
    base_currency,
    exchange_rate,
    financial_date,
    note,
    client_mutation_id,
    created_by
  )
  values (
    v_workspace_id,
    v_account_id,
    case when p_input ? 'splits' then null else v_category_id end,
    v_merchant_id,
    v_type,
    v_amount,
    v_currency,
    v_amount,
    v_workspace.base_currency,
    1,
    v_financial_date,
    nullif(btrim(p_input ->> 'note'), ''),
    v_mutation_id,
    v_user_id
  )
  returning id into v_transaction_id;

  if p_input ? 'splits' then
    for v_split in
      select value from jsonb_array_elements(p_input -> 'splits')
    loop
      insert into public.transaction_splits (
        transaction_id,
        category_id,
        amount,
        note,
        position
      )
      values (
        v_transaction_id,
        (v_split ->> 'categoryId')::uuid,
        (v_split ->> 'amount')::numeric,
        nullif(btrim(v_split ->> 'note'), ''),
        v_position
      );
      v_position := v_position + 1;
    end loop;
  end if;

  if p_input ? 'tagIds' then
    insert into public.transaction_tags (transaction_id, tag_id)
    select
      v_transaction_id,
      (value #>> '{}')::uuid
    from jsonb_array_elements(p_input -> 'tagIds');
  end if;

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
    'transaction.posted',
    'transaction',
    v_transaction_id
  );

  return public.transaction_response(v_transaction_id);
end;
$$;

create function public.void_transaction(
  p_transaction_id uuid,
  p_version integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_transaction public.transactions%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  select * into v_transaction
  from public.transactions
  where id = p_transaction_id
  for update;
  if not found
    or public.workspace_role_for(v_transaction.workspace_id)
      not in ('owner', 'editor')
  then
    raise exception using errcode = '42501', message = 'workspace access denied';
  end if;
  if v_transaction.version <> p_version
    or v_transaction.state <> 'posted'
  then
    raise exception using errcode = '40001', message = 'stale version';
  end if;
  if char_length(btrim(p_reason)) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'invalid void reason';
  end if;

  update public.transactions
  set
    state = 'void',
    voided_at = now(),
    voided_by = v_user_id,
    void_reason = btrim(p_reason),
    updated_at = now(),
    version = version + 1
  where id = p_transaction_id;

  insert into public.audit_events (
    workspace_id,
    actor_user_id,
    action,
    entity_type,
    entity_id
  )
  values (
    v_transaction.workspace_id,
    v_user_id,
    'transaction.voided',
    'transaction',
    p_transaction_id
  );

  return public.transaction_response(p_transaction_id);
end;
$$;

create function public.create_account_with_opening_balance(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid := (p_input ->> 'workspaceId')::uuid;
  v_currency text := p_input ->> 'currency';
  v_opening numeric(20, 4) :=
    coalesce((p_input ->> 'openingBalance')::numeric, 0);
  v_account public.accounts%rowtype;
  v_workspace public.workspaces%rowtype;
  v_transaction_id uuid;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  select * into v_account
  from public.create_account(
    v_workspace_id,
    p_input ->> 'name',
    (p_input ->> 'type')::public.account_type,
    v_currency,
    p_input ->> 'institution'
  );
  select * into v_workspace
  from public.workspaces where id = v_workspace_id;

  if v_opening <> 0 then
    insert into public.transactions (
      workspace_id,
      account_id,
      type,
      amount,
      currency,
      base_amount,
      base_currency,
      exchange_rate,
      financial_date,
      note,
      client_mutation_id,
      created_by
    )
    values (
      v_workspace_id,
      v_account.id,
      'balance_adjustment',
      v_opening,
      v_currency,
      v_opening,
      v_workspace.base_currency,
      1,
      (now() at time zone v_workspace.timezone)::date,
      'Opening balance',
      gen_random_uuid(),
      v_user_id
    )
    returning id into v_transaction_id;

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
      'transaction.opening_balance_posted',
      'transaction',
      v_transaction_id
    );
  end if;

  select jsonb_build_object(
    'account', jsonb_build_object(
      'id', v_account.id,
      'workspaceId', v_account.workspace_id,
      'name', v_account.name,
      'type', v_account.type,
      'currency', v_account.currency,
      'institution', v_account.institution,
      'version', v_account.version
    ),
    'accountBalance', jsonb_build_object(
      'accountId', balance.account_id,
      'amount', public.format_money(balance.amount, balance.currency),
      'currency', balance.currency
    )
  )
  into v_result
  from public.account_balances balance
  where balance.account_id = v_account.id;

  if v_transaction_id is not null then
    v_result := v_result || jsonb_build_object(
      'openingTransaction',
      jsonb_build_object(
        'transactionId', v_transaction_id,
        'state', 'posted',
        'version', 1
      )
    );
  end if;

  return v_result;
end;
$$;

revoke all on function public.format_money(numeric, text) from public;
revoke all on function public.transaction_response(uuid) from public;
revoke all on function public.post_transaction(jsonb) from public;
revoke all on function public.void_transaction(uuid, integer, text) from public;
revoke all on function public.create_account_with_opening_balance(jsonb)
  from public;

grant execute on function public.post_transaction(jsonb) to authenticated;
grant execute on function public.void_transaction(uuid, integer, text)
  to authenticated;
grant execute on function public.create_account_with_opening_balance(jsonb)
  to authenticated;

grant select on public.transactions to authenticated;
grant select on public.transaction_splits to authenticated;
grant select on public.transaction_tags to authenticated;
grant select on public.account_balances to authenticated;
