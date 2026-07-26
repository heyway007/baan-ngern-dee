create table public.transfers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.workspaces (id) on delete cascade,
  source_amount numeric(20, 4) not null check (source_amount > 0),
  source_currency text not null check (source_currency ~ '^[A-Z]{3}$'),
  destination_amount numeric(20, 4) not null
    check (destination_amount > 0),
  destination_currency text not null
    check (destination_currency ~ '^[A-Z]{3}$'),
  exchange_rate numeric(20, 10) not null check (exchange_rate > 0),
  fee_amount numeric(20, 4) not null default 0 check (fee_amount >= 0),
  financial_date date not null,
  note text check (note is null or char_length(note) <= 500),
  state public.transaction_state not null default 'posted',
  client_mutation_id uuid not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (created_by, client_mutation_id)
);

create table public.transfer_links (
  transfer_id uuid primary key
    references public.transfers (id) on delete cascade,
  source_account_id uuid not null references public.accounts (id),
  destination_account_id uuid not null references public.accounts (id),
  fee_transaction_id uuid references public.transactions (id),
  check (source_account_id <> destination_account_id)
);

create index transfer_workspace_date
  on public.transfers (workspace_id, financial_date desc);
create index transfer_source_account
  on public.transfer_links (source_account_id);
create index transfer_destination_account
  on public.transfer_links (destination_account_id);

alter table public.transfers enable row level security;
alter table public.transfer_links enable row level security;

create policy transfer_select_member
on public.transfers for select
using (public.is_workspace_member(workspace_id));

create policy transfer_link_select_member
on public.transfer_links for select
using (
  exists (
    select 1
    from public.transfers transfer
    where transfer.id = transfer_id
      and public.is_workspace_member(transfer.workspace_id)
  )
);

create or replace view public.account_balances
with (security_invoker = true)
as
with ledger_effects as (
  select
    transaction.account_id,
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
    end as amount
  from public.transactions transaction
  join public.accounts account on account.id = transaction.account_id
  where transaction.state = 'posted'

  union all

  select
    link.source_account_id,
    case
      when source.type in ('credit_card', 'loan')
        then transfer.source_amount
      else -transfer.source_amount
    end
  from public.transfers transfer
  join public.transfer_links link on link.transfer_id = transfer.id
  join public.accounts source on source.id = link.source_account_id
  where transfer.state = 'posted'

  union all

  select
    link.destination_account_id,
    case
      when destination.type in ('credit_card', 'loan')
        then -transfer.destination_amount
      else transfer.destination_amount
    end
  from public.transfers transfer
  join public.transfer_links link on link.transfer_id = transfer.id
  join public.accounts destination
    on destination.id = link.destination_account_id
  where transfer.state = 'posted'
)
select
  account.workspace_id,
  account.id as account_id,
  account.currency,
  coalesce(sum(effect.amount), 0)::numeric(20, 4) as amount
from public.accounts account
left join ledger_effects effect on effect.account_id = account.id
group by account.workspace_id, account.id, account.currency;

create function public.transfer_response(p_transfer_id uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'transferId', transfer.id,
    'state', transfer.state,
    'reportEffect', jsonb_build_object(
      'income', public.format_money(0, transfer.source_currency),
      'expense', public.format_money(
        transfer.fee_amount,
        transfer.source_currency
      ),
      'cashFlow', public.format_money(
        -transfer.fee_amount,
        transfer.source_currency
      )
    ),
    'accountBalances', (
      select jsonb_agg(
        jsonb_build_object(
          'accountId', balance.account_id,
          'amount', public.format_money(
            balance.amount,
            balance.currency
          ),
          'currency', balance.currency
        )
        order by balance.account_id
      )
      from public.account_balances balance
      where balance.account_id in (
        link.source_account_id,
        link.destination_account_id
      )
    )
  )
  from public.transfers transfer
  join public.transfer_links link on link.transfer_id = transfer.id
  where transfer.id = p_transfer_id
$$;

create function public.post_transfer(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid := (p_input ->> 'workspaceId')::uuid;
  v_source_id uuid := (p_input ->> 'sourceAccountId')::uuid;
  v_destination_id uuid :=
    (p_input ->> 'destinationAccountId')::uuid;
  v_source_amount numeric(20, 4) :=
    (p_input ->> 'sourceAmount')::numeric;
  v_destination_amount numeric(20, 4) :=
    (p_input ->> 'destinationAmount')::numeric;
  v_source_currency text := p_input ->> 'sourceCurrency';
  v_destination_currency text :=
    p_input ->> 'destinationCurrency';
  v_exchange_rate numeric(20, 10);
  v_fee_amount numeric(20, 4) :=
    coalesce((p_input ->> 'feeAmount')::numeric, 0);
  v_fee_category_id uuid;
  v_mutation_id uuid := (p_input ->> 'clientMutationId')::uuid;
  v_source public.accounts%rowtype;
  v_destination public.accounts%rowtype;
  v_transfer_id uuid;
  v_existing_id uuid;
  v_fee_transaction_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if v_source_id = v_destination_id
    or v_source_amount <= 0
    or v_destination_amount <= 0
    or v_fee_amount < 0
  then
    raise exception using errcode = '22023', message = 'invalid transfer';
  end if;

  select * into v_source
  from public.accounts
  where id = v_source_id
    and workspace_id = v_workspace_id
    and archived_at is null
  for update;
  select * into v_destination
  from public.accounts
  where id = v_destination_id
    and workspace_id = v_workspace_id
    and archived_at is null
  for update;
  if v_source.id is null
    or v_destination.id is null
    or public.workspace_role_for(v_workspace_id)
      not in ('owner', 'editor')
  then
    raise exception using errcode = '42501', message = 'workspace access denied';
  end if;
  if v_source.currency <> v_source_currency
    or v_destination.currency <> v_destination_currency
  then
    raise exception using errcode = '22023', message = 'currency mismatch';
  end if;

  if v_source_currency = v_destination_currency then
    if v_source_amount <> v_destination_amount then
      raise exception using
        errcode = '22023',
        message = 'same-currency amounts must match';
    end if;
    v_exchange_rate := 1;
  else
    v_exchange_rate := (p_input ->> 'exchangeRate')::numeric;
    if v_exchange_rate is null or v_exchange_rate <= 0 then
      raise exception using
        errcode = '22023',
        message = 'positive exchange rate required';
    end if;
  end if;

  if v_fee_amount > 0 then
    v_fee_category_id := (p_input ->> 'feeCategoryId')::uuid;
    if not exists (
      select 1
      from public.categories
      where id = v_fee_category_id
        and workspace_id = v_workspace_id
        and kind = 'expense'
        and archived_at is null
    ) then
      raise exception using
        errcode = '22023',
        message = 'invalid fee category';
    end if;
  end if;

  select id into v_existing_id
  from public.transfers
  where created_by = v_user_id
    and client_mutation_id = v_mutation_id;
  if found then
    return public.transfer_response(v_existing_id);
  end if;

  insert into public.transfers (
    workspace_id,
    source_amount,
    source_currency,
    destination_amount,
    destination_currency,
    exchange_rate,
    fee_amount,
    financial_date,
    note,
    client_mutation_id,
    created_by
  )
  values (
    v_workspace_id,
    v_source_amount,
    v_source_currency,
    v_destination_amount,
    v_destination_currency,
    v_exchange_rate,
    v_fee_amount,
    (p_input ->> 'financialDate')::date,
    nullif(btrim(p_input ->> 'note'), ''),
    v_mutation_id,
    v_user_id
  )
  returning id into v_transfer_id;

  if v_fee_amount > 0 then
    insert into public.transactions (
      workspace_id,
      account_id,
      category_id,
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
    select
      v_workspace_id,
      v_source_id,
      v_fee_category_id,
      'expense',
      v_fee_amount,
      v_source_currency,
      v_fee_amount,
      workspace.base_currency,
      1,
      (p_input ->> 'financialDate')::date,
      'Transfer fee',
      gen_random_uuid(),
      v_user_id
    from public.workspaces workspace
    where workspace.id = v_workspace_id
    returning id into v_fee_transaction_id;
  end if;

  insert into public.transfer_links (
    transfer_id,
    source_account_id,
    destination_account_id,
    fee_transaction_id
  )
  values (
    v_transfer_id,
    v_source_id,
    v_destination_id,
    v_fee_transaction_id
  );

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
    'transfer.posted',
    'transfer',
    v_transfer_id
  );

  return public.transfer_response(v_transfer_id);
end;
$$;

revoke all on function public.transfer_response(uuid) from public;
revoke all on function public.post_transfer(jsonb) from public;
grant execute on function public.post_transfer(jsonb) to authenticated;

grant select on public.transfers to authenticated;
grant select on public.transfer_links to authenticated;
