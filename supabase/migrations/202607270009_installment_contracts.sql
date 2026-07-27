create type public.installment_contract_kind as enum (
  'purchase',
  'debt'
);
create type public.installment_interest_method as enum (
  'zero',
  'flat',
  'reducing',
  'manual'
);
create type public.installment_contract_status as enum (
  'draft',
  'active',
  'paid_off',
  'cancelled',
  'defaulted'
);
create type public.installment_schedule_status as enum (
  'upcoming',
  'due',
  'partially_paid',
  'paid',
  'overdue',
  'waived',
  'cancelled'
);
create type public.installment_payoff_action as enum (
  'extra_principal',
  'payoff'
);
create type public.installment_extra_strategy as enum (
  'reduce_payment',
  'shorten_term'
);

create table public.installment_contracts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  kind public.installment_contract_kind not null,
  creditor text check (
    creditor is null or char_length(btrim(creditor)) between 1 and 120
  ),
  original_principal numeric(20, 4) not null
    check (original_principal > 0),
  down_payment numeric(20, 4) not null default 0
    check (down_payment >= 0),
  financed_principal numeric(20, 4) not null
    check (financed_principal > 0),
  financed_fees numeric(20, 4) not null default 0
    check (financed_fees >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  interest_method public.installment_interest_method not null,
  annual_rate numeric(20, 10) not null default 0
    check (annual_rate >= 0),
  periods integer not null check (periods between 1 and 600),
  first_due_date date not null,
  funding_account_id uuid references public.accounts (id),
  expense_category_id uuid references public.categories (id),
  interest_category_id uuid references public.categories (id),
  status public.installment_contract_status not null default 'active',
  version integer not null default 1 check (version > 0),
  client_mutation_id uuid not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  request_json jsonb not null,
  response_json jsonb,
  check (down_payment < original_principal),
  check (financed_principal = original_principal - down_payment),
  unique (created_by, client_mutation_id)
);

create table public.installment_schedule_rows (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null
    references public.installment_contracts (id) on delete cascade,
  workspace_id uuid not null
    references public.workspaces (id) on delete cascade,
  sequence integer not null check (sequence between 1 and 600),
  due_date date not null,
  opening_principal numeric(20, 4) not null
    check (opening_principal >= 0),
  scheduled_principal numeric(20, 4) not null
    check (scheduled_principal >= 0),
  scheduled_interest numeric(20, 4) not null
    check (scheduled_interest >= 0),
  scheduled_fees numeric(20, 4) not null
    check (scheduled_fees >= 0),
  scheduled_penalty numeric(20, 4) not null default 0
    check (scheduled_penalty >= 0),
  paid_principal numeric(20, 4) not null default 0
    check (paid_principal >= 0),
  paid_interest numeric(20, 4) not null default 0
    check (paid_interest >= 0),
  paid_fees numeric(20, 4) not null default 0
    check (paid_fees >= 0),
  paid_penalty numeric(20, 4) not null default 0
    check (paid_penalty >= 0),
  closing_principal numeric(20, 4) not null
    check (closing_principal >= 0),
  status public.installment_schedule_status not null default 'upcoming',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (paid_principal <= scheduled_principal),
  check (paid_interest <= scheduled_interest),
  check (paid_fees <= scheduled_fees),
  check (paid_penalty <= scheduled_penalty)
);

create table public.installment_payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.workspaces (id) on delete cascade,
  contract_id uuid not null
    references public.installment_contracts (id) on delete cascade,
  schedule_row_id uuid not null
    references public.installment_schedule_rows (id),
  account_id uuid not null references public.accounts (id),
  amount numeric(20, 4) not null check (amount > 0),
  allocated_principal numeric(20, 4) not null check (allocated_principal >= 0),
  allocated_interest numeric(20, 4) not null check (allocated_interest >= 0),
  allocated_fees numeric(20, 4) not null check (allocated_fees >= 0),
  allocated_penalty numeric(20, 4) not null check (allocated_penalty >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  financial_date date not null,
  note text check (note is null or char_length(note) <= 500),
  client_mutation_id uuid not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  request_json jsonb not null,
  response_json jsonb,
  check (
    amount = allocated_principal + allocated_interest
      + allocated_fees + allocated_penalty
  ),
  unique (created_by, client_mutation_id)
);

create table public.installment_payoffs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.workspaces (id) on delete cascade,
  contract_id uuid not null
    references public.installment_contracts (id) on delete cascade,
  account_id uuid not null references public.accounts (id),
  action public.installment_payoff_action not null,
  strategy public.installment_extra_strategy,
  principal_payment numeric(20, 4) not null
    check (principal_payment > 0),
  interest_due numeric(20, 4) not null check (interest_due >= 0),
  fees_due numeric(20, 4) not null check (fees_due >= 0),
  total_cash_required numeric(20, 4) not null
    check (total_cash_required > 0),
  remaining_principal numeric(20, 4) not null
    check (remaining_principal >= 0),
  interest_saved numeric(20, 4) not null check (interest_saved >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  financial_date date not null,
  note text check (note is null or char_length(note) <= 500),
  prior_schedule jsonb not null,
  client_mutation_id uuid not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  request_json jsonb not null,
  response_json jsonb,
  check (
    total_cash_required = principal_payment + interest_due + fees_due
  ),
  check (
    (action = 'payoff' and strategy is null and remaining_principal = 0)
    or (action = 'extra_principal' and strategy is not null)
  ),
  unique (created_by, client_mutation_id)
);

create table public.installment_cash_movements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.workspaces (id) on delete cascade,
  account_id uuid not null references public.accounts (id),
  payment_id uuid references public.installment_payments (id)
    on delete cascade,
  payoff_id uuid references public.installment_payoffs (id)
    on delete cascade,
  amount numeric(20, 4) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  financial_date date not null,
  created_at timestamptz not null default now(),
  check (
    (payment_id is not null and payoff_id is null)
    or (payment_id is null and payoff_id is not null)
  )
);

create table public.installment_transaction_links (
  transaction_id uuid primary key
    references public.transactions (id) on delete cascade,
  payment_id uuid references public.installment_payments (id)
    on delete cascade,
  payoff_id uuid references public.installment_payoffs (id)
    on delete cascade,
  check (
    (payment_id is not null and payoff_id is null)
    or (payment_id is null and payoff_id is not null)
  )
);

create index installment_contract_workspace_status
  on public.installment_contracts (workspace_id, status);
create index installment_schedule_contract_date
  on public.installment_schedule_rows (contract_id, due_date);
create unique index installment_schedule_active_sequence
  on public.installment_schedule_rows (contract_id, sequence)
  where status not in ('cancelled', 'waived');
create index installment_payment_contract_date
  on public.installment_payments (contract_id, financial_date desc);
create index installment_payoff_contract_date
  on public.installment_payoffs (contract_id, financial_date desc);
create index installment_cash_account_date
  on public.installment_cash_movements (account_id, financial_date desc);

alter table public.installment_contracts enable row level security;
alter table public.installment_schedule_rows enable row level security;
alter table public.installment_payments enable row level security;
alter table public.installment_payoffs enable row level security;
alter table public.installment_cash_movements enable row level security;
alter table public.installment_transaction_links enable row level security;

create policy installment_contract_select_member
on public.installment_contracts for select
using (public.is_workspace_member(workspace_id));

create policy installment_schedule_select_member
on public.installment_schedule_rows for select
using (public.is_workspace_member(workspace_id));

create policy installment_payment_select_member
on public.installment_payments for select
using (public.is_workspace_member(workspace_id));

create policy installment_payoff_select_member
on public.installment_payoffs for select
using (public.is_workspace_member(workspace_id));

create policy installment_cash_select_member
on public.installment_cash_movements for select
using (public.is_workspace_member(workspace_id));

create policy installment_transaction_link_select_member
on public.installment_transaction_links for select
using (
  exists (
    select 1
    from public.transactions transaction
    where transaction.id = transaction_id
      and public.is_workspace_member(transaction.workspace_id)
  )
);

drop view public.account_balances;
create view public.account_balances
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
  left join public.installment_transaction_links installment_link
    on installment_link.transaction_id = transaction.id
  where transaction.state = 'posted'
    and installment_link.transaction_id is null

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

  union all

  select movement.account_id, -movement.amount
  from public.installment_cash_movements movement
)
select
  account.workspace_id,
  account.id as account_id,
  account.currency,
  coalesce(sum(effect.amount), 0)::numeric(20, 4) as amount
from public.accounts account
left join ledger_effects effect on effect.account_id = account.id
group by account.workspace_id, account.id, account.currency;

grant select on public.account_balances to authenticated;

create function public.installment_contract_response(
  p_contract_id uuid
)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'contract', jsonb_build_object(
      'id', contract.id,
      'workspaceId', contract.workspace_id,
      'name', contract.name,
      'kind', contract.kind,
      'creditor', contract.creditor,
      'originalPrincipal', public.format_money(
        contract.original_principal,
        contract.currency
      ),
      'downPayment', public.format_money(
        contract.down_payment,
        contract.currency
      ),
      'financedPrincipal', public.format_money(
        contract.financed_principal,
        contract.currency
      ),
      'financedFees', public.format_money(
        contract.financed_fees,
        contract.currency
      ),
      'currency', contract.currency,
      'interestMethod', contract.interest_method,
      'annualRate', contract.annual_rate::text,
      'periods', contract.periods,
      'firstDueDate', contract.first_due_date,
      'fundingAccountId', contract.funding_account_id,
      'expenseCategoryId', contract.expense_category_id,
      'interestCategoryId', contract.interest_category_id,
      'status', contract.status,
      'version', contract.version
    ),
    'schedule', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'sequence', schedule.sequence,
            'dueDate', schedule.due_date,
            'openingPrincipal', public.format_money(
              schedule.opening_principal,
              contract.currency
            ),
            'principal', public.format_money(
              schedule.scheduled_principal,
              contract.currency
            ),
            'interest', public.format_money(
              schedule.scheduled_interest,
              contract.currency
            ),
            'fees', public.format_money(
              schedule.scheduled_fees,
              contract.currency
            ),
            'total', public.format_money(
              schedule.scheduled_principal
                + schedule.scheduled_interest
                + schedule.scheduled_fees,
              contract.currency
            ),
            'closingPrincipal', public.format_money(
              schedule.closing_principal,
              contract.currency
            ),
            'scheduledPenalty', public.format_money(
              schedule.scheduled_penalty,
              contract.currency
            ),
            'paidPrincipal', public.format_money(
              schedule.paid_principal,
              contract.currency
            ),
            'paidInterest', public.format_money(
              schedule.paid_interest,
              contract.currency
            ),
            'paidFees', public.format_money(
              schedule.paid_fees,
              contract.currency
            ),
            'paidPenalty', public.format_money(
              schedule.paid_penalty,
              contract.currency
            ),
            'status', schedule.status
          )
          order by schedule.sequence
        ),
        '[]'::jsonb
      )
      from public.installment_schedule_rows schedule
      where schedule.contract_id = contract.id
        and schedule.status not in ('cancelled', 'waived')
    )
  )
  from public.installment_contracts contract
  where contract.id = p_contract_id
$$;

create function public.create_installment_contract(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid := (p_input ->> 'workspaceId')::uuid;
  v_mutation_id uuid := (p_input ->> 'clientMutationId')::uuid;
  v_contract_id uuid;
  v_existing_workspace_id uuid;
  v_existing_request jsonb;
  v_existing_response jsonb;
  v_original numeric(20, 4) :=
    (p_input ->> 'originalPrincipal')::numeric;
  v_down numeric(20, 4) :=
    coalesce((p_input ->> 'downPayment')::numeric, 0);
  v_financed numeric(20, 4) :=
    (p_input ->> 'financedPrincipal')::numeric;
  v_currency text := p_input ->> 'currency';
  v_periods integer := (p_input ->> 'periods')::integer;
  v_row jsonb;
  v_row_count integer := 0;
  v_principal_total numeric(20, 4) := 0;
  v_interest_total numeric(20, 4) := 0;
  v_fee_total numeric(20, 4) := 0;
  v_previous_sequence integer;
  v_previous_due_date date;
  v_previous_closing numeric(20, 4);
  v_scale integer;
  v_response jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(v_user_id::text || ':' || v_mutation_id::text)
  );
  select workspace_id, request_json, response_json
  into
    v_existing_workspace_id,
    v_existing_request,
    v_existing_response
  from public.installment_contracts
  where created_by = v_user_id
    and client_mutation_id = v_mutation_id;
  if found then
    if v_existing_workspace_id <> v_workspace_id
      or v_existing_request <> p_input
    then
      raise exception using errcode = '22023', message = 'mutation payload mismatch';
    end if;
    if coalesce(
      public.workspace_role_for(v_workspace_id)::text,
      ''
    ) not in ('owner', 'editor')
    then
      raise exception using errcode = '42501', message = 'workspace access denied';
    end if;
    return jsonb_build_object(
      'response', v_existing_response,
      'replayed', true
    );
  end if;

  if coalesce(
    public.workspace_role_for(v_workspace_id)::text,
    ''
  ) not in ('owner', 'editor')
  then
    raise exception using errcode = '42501', message = 'workspace access denied';
  end if;
  if v_original <= 0
    or v_down < 0
    or v_down >= v_original
    or v_financed <> v_original - v_down
    or jsonb_typeof(p_input -> 'schedule') <> 'array'
    or jsonb_array_length(p_input -> 'schedule') <> v_periods
  then
    raise exception using errcode = '22023', message = 'invalid installment contract';
  end if;
  if p_input ? 'fundingAccountId' and not exists (
    select 1
    from public.accounts account
    where account.id = (p_input ->> 'fundingAccountId')::uuid
      and account.workspace_id = v_workspace_id
      and account.currency = v_currency
      and account.archived_at is null
  ) then
    raise exception using errcode = '22023', message = 'invalid funding account';
  end if;
  if exists (
    select 1
    from (
      values
        (nullif(p_input ->> 'expenseCategoryId', '')::uuid),
        (nullif(p_input ->> 'interestCategoryId', '')::uuid)
    ) category_ids(id)
    where category_ids.id is not null
      and not exists (
        select 1
        from public.categories category
        where category.id = category_ids.id
          and category.workspace_id = v_workspace_id
          and category.kind = 'expense'
          and category.archived_at is null
      )
  ) then
    raise exception using errcode = '22023', message = 'invalid expense category';
  end if;

  v_scale := case
    when v_currency in ('JPY', 'KRW', 'VND', 'CLP', 'ISK') then 0
    when v_currency in ('BHD', 'KWD', 'OMR', 'JOD', 'TND', 'LYD') then 3
    when v_currency = 'CLF' then 4
    else 2
  end;
  for v_row in
    select value
    from jsonb_array_elements(p_input -> 'schedule')
    order by (value ->> 'sequence')::integer
  loop
    v_row_count := v_row_count + 1;
    if (v_row ->> 'principal')::numeric <= 0
      or (v_row ->> 'interest')::numeric < 0
      or (v_row ->> 'fees')::numeric < 0
      or (v_row ->> 'openingPrincipal')::numeric < 0
      or (v_row ->> 'closingPrincipal')::numeric < 0
      or (v_row ->> 'total')::numeric <>
        (v_row ->> 'principal')::numeric
          + (v_row ->> 'interest')::numeric
          + (v_row ->> 'fees')::numeric
      or (v_row ->> 'openingPrincipal')::numeric
          - (v_row ->> 'principal')::numeric
        <> (v_row ->> 'closingPrincipal')::numeric
      or (
        v_row_count = 1
        and (
          (v_row ->> 'sequence')::integer <> 1
          or (v_row ->> 'dueDate')::date
            <> (p_input ->> 'firstDueDate')::date
          or (v_row ->> 'openingPrincipal')::numeric <> v_financed
        )
      )
      or (
        v_previous_sequence is not null
        and (
          (v_row ->> 'sequence')::integer
            <> v_previous_sequence + 1
          or (v_row ->> 'dueDate')::date <= v_previous_due_date
        )
      )
      or (
        v_previous_closing is not null
        and (v_row ->> 'openingPrincipal')::numeric
          <> v_previous_closing
      )
      or (
        (p_input ->> 'interestMethod') = 'zero'
        and (v_row ->> 'interest')::numeric <> 0
      )
      or (
        (p_input ->> 'interestMethod') = 'reducing'
        and (v_row ->> 'interest')::numeric <>
          round(
            (v_row ->> 'openingPrincipal')::numeric
              * (p_input ->> 'annualRate')::numeric / 1200,
            v_scale
          )
      )
    then
      raise exception using errcode = '22023', message = 'invalid installment schedule';
    end if;
    v_principal_total :=
      v_principal_total + (v_row ->> 'principal')::numeric;
    v_interest_total :=
      v_interest_total + (v_row ->> 'interest')::numeric;
    v_fee_total := v_fee_total + (v_row ->> 'fees')::numeric;
    v_previous_sequence := (v_row ->> 'sequence')::integer;
    v_previous_due_date := (v_row ->> 'dueDate')::date;
    v_previous_closing := (v_row ->> 'closingPrincipal')::numeric;
  end loop;
  if v_principal_total <> v_financed
    or v_previous_closing <> 0
    or (
      (p_input ->> 'interestMethod') <> 'manual'
      and v_fee_total <>
        coalesce((p_input ->> 'financedFees')::numeric, 0)
    )
    or (
      (p_input ->> 'interestMethod') = 'flat'
      and v_interest_total <>
        round(
          v_financed
            * (p_input ->> 'annualRate')::numeric
            * v_periods / 1200,
          v_scale
        )
    )
  then
    raise exception using errcode = '22023', message = 'schedule principal mismatch';
  end if;

  insert into public.installment_contracts (
    workspace_id,
    name,
    kind,
    creditor,
    original_principal,
    down_payment,
    financed_principal,
    financed_fees,
    currency,
    interest_method,
    annual_rate,
    periods,
    first_due_date,
    funding_account_id,
    expense_category_id,
    interest_category_id,
    client_mutation_id,
    created_by,
    request_json
  )
  values (
    v_workspace_id,
    btrim(p_input ->> 'name'),
    (p_input ->> 'kind')::public.installment_contract_kind,
    nullif(btrim(p_input ->> 'creditor'), ''),
    v_original,
    v_down,
    v_financed,
    coalesce((p_input ->> 'financedFees')::numeric, 0),
    v_currency,
    (p_input ->> 'interestMethod')::public.installment_interest_method,
    coalesce((p_input ->> 'annualRate')::numeric, 0),
    v_periods,
    (p_input ->> 'firstDueDate')::date,
    nullif(p_input ->> 'fundingAccountId', '')::uuid,
    nullif(p_input ->> 'expenseCategoryId', '')::uuid,
    nullif(p_input ->> 'interestCategoryId', '')::uuid,
    v_mutation_id,
    v_user_id,
    p_input
  )
  returning id into v_contract_id;

  insert into public.installment_schedule_rows (
    contract_id,
    workspace_id,
    sequence,
    due_date,
    opening_principal,
    scheduled_principal,
    scheduled_interest,
    scheduled_fees,
    closing_principal
  )
  select
    v_contract_id,
    v_workspace_id,
    (row ->> 'sequence')::integer,
    (row ->> 'dueDate')::date,
    (row ->> 'openingPrincipal')::numeric,
    (row ->> 'principal')::numeric,
    (row ->> 'interest')::numeric,
    (row ->> 'fees')::numeric,
    (row ->> 'closingPrincipal')::numeric
  from jsonb_array_elements(p_input -> 'schedule') row;

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
    'installment.created',
    'installment_contract',
    v_contract_id
  );

  v_response := public.installment_contract_response(v_contract_id);
  update public.installment_contracts
  set response_json = v_response
  where id = v_contract_id;
  return jsonb_build_object(
    'response', v_response,
    'replayed', false
  );
end;
$$;

create function public.post_installment_payment(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid := (p_input ->> 'workspaceId')::uuid;
  v_contract_id uuid := (p_input ->> 'contractId')::uuid;
  v_account_id uuid := (p_input ->> 'accountId')::uuid;
  v_mutation_id uuid := (p_input ->> 'clientMutationId')::uuid;
  v_amount numeric(20, 4) := (p_input ->> 'amount')::numeric;
  v_penalty_add numeric(20, 4) :=
    coalesce((p_input ->> 'penaltyAmount')::numeric, 0);
  v_expected_version integer :=
    (p_input ->> 'expectedVersion')::integer;
  v_contract public.installment_contracts%rowtype;
  v_schedule public.installment_schedule_rows%rowtype;
  v_payment_id uuid;
  v_expense_transaction_id uuid;
  v_existing_workspace_id uuid;
  v_existing_contract_id uuid;
  v_existing_request jsonb;
  v_existing_response jsonb;
  v_balance numeric(20, 4);
  v_remaining numeric(20, 4);
  v_penalty numeric(20, 4);
  v_fees numeric(20, 4);
  v_interest numeric(20, 4);
  v_principal numeric(20, 4);
  v_reportable numeric(20, 4);
  v_schedule_status public.installment_schedule_status;
  v_contract_status public.installment_contract_status;
  v_response jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  perform pg_advisory_xact_lock(
    hashtext(v_user_id::text || ':' || v_mutation_id::text)
  );
  select workspace_id, contract_id, request_json, response_json
  into
    v_existing_workspace_id,
    v_existing_contract_id,
    v_existing_request,
    v_existing_response
  from public.installment_payments
  where created_by = v_user_id
    and client_mutation_id = v_mutation_id;
  if found then
    if v_existing_workspace_id <> v_workspace_id
      or v_existing_contract_id <> v_contract_id
      or v_existing_request <> p_input
    then
      raise exception using errcode = '22023', message = 'mutation payload mismatch';
    end if;
    if coalesce(
      public.workspace_role_for(v_workspace_id)::text,
      ''
    ) not in ('owner', 'editor')
    then
      raise exception using errcode = '42501', message = 'workspace access denied';
    end if;
    return jsonb_build_object(
      'response', v_existing_response,
      'replayed', true
    );
  end if;

  select * into v_contract
  from public.installment_contracts
  where id = v_contract_id
    and workspace_id = v_workspace_id
  for update;
  if not found
    or v_contract.status <> 'active'
    or coalesce(
      public.workspace_role_for(v_workspace_id)::text,
      ''
    ) not in ('owner', 'editor')
  then
    raise exception using errcode = '42501', message = 'installment access denied';
  end if;
  if v_contract.version <> v_expected_version then
    raise exception using errcode = '40001', message = 'stale version';
  end if;
  if v_contract.currency <> p_input ->> 'currency'
    or v_amount <= 0
    or v_penalty_add < 0
  then
    raise exception using errcode = '22023', message = 'invalid payment';
  end if;

  perform 1
  from public.accounts account
  where account.id = v_account_id
    and account.workspace_id = v_workspace_id
    and account.currency = v_contract.currency
    and account.type in ('cash', 'bank', 'ewallet')
    and account.archived_at is null
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'invalid payment account';
  end if;
  select amount into v_balance
  from public.account_balances
  where account_id = v_account_id;
  if v_balance < v_amount then
    raise exception using errcode = '22000', message = 'insufficient balance';
  end if;

  select * into v_schedule
  from public.installment_schedule_rows
  where contract_id = v_contract_id
    and sequence = (p_input ->> 'sequence')::integer
    and status not in ('cancelled', 'waived')
  for update;
  if not found or v_schedule.status in ('paid', 'cancelled', 'waived') then
    raise exception using errcode = '22023', message = 'invalid schedule row';
  end if;

  v_schedule.scheduled_penalty :=
    v_schedule.scheduled_penalty + v_penalty_add;
  v_remaining := v_amount;
  v_penalty := least(
    v_schedule.scheduled_penalty - v_schedule.paid_penalty,
    v_remaining
  );
  v_remaining := v_remaining - v_penalty;
  v_fees := least(
    v_schedule.scheduled_fees - v_schedule.paid_fees,
    v_remaining
  );
  v_remaining := v_remaining - v_fees;
  v_interest := least(
    v_schedule.scheduled_interest - v_schedule.paid_interest,
    v_remaining
  );
  v_remaining := v_remaining - v_interest;
  v_principal := least(
    v_schedule.scheduled_principal - v_schedule.paid_principal,
    v_remaining
  );
  v_remaining := v_remaining - v_principal;
  if v_remaining <> 0 then
    raise exception using errcode = '22023', message = 'payment exceeds remaining';
  end if;
  v_reportable := v_penalty + v_fees + v_interest;
  v_schedule_status := case
    when v_schedule.paid_principal + v_principal
        = v_schedule.scheduled_principal
      and v_schedule.paid_interest + v_interest
        = v_schedule.scheduled_interest
      and v_schedule.paid_fees + v_fees
        = v_schedule.scheduled_fees
      and v_schedule.paid_penalty + v_penalty
        = v_schedule.scheduled_penalty
      then 'paid'::public.installment_schedule_status
    else 'partially_paid'::public.installment_schedule_status
  end;

  update public.installment_schedule_rows
  set
    scheduled_penalty = v_schedule.scheduled_penalty,
    paid_principal = paid_principal + v_principal,
    paid_interest = paid_interest + v_interest,
    paid_fees = paid_fees + v_fees,
    paid_penalty = paid_penalty + v_penalty,
    status = v_schedule_status,
    updated_at = now()
  where id = v_schedule.id;

  v_contract_status := case
    when not exists (
      select 1
      from public.installment_schedule_rows row
      where row.contract_id = v_contract_id
        and row.status not in ('paid', 'cancelled', 'waived')
    ) then 'paid_off'::public.installment_contract_status
    else 'active'::public.installment_contract_status
  end;
  update public.installment_contracts
  set
    status = v_contract_status,
    version = version + 1,
    updated_at = now()
  where id = v_contract_id;

  insert into public.installment_payments (
    workspace_id,
    contract_id,
    schedule_row_id,
    account_id,
    amount,
    allocated_principal,
    allocated_interest,
    allocated_fees,
    allocated_penalty,
    currency,
    financial_date,
    note,
    client_mutation_id,
    created_by,
    request_json
  )
  values (
    v_workspace_id,
    v_contract_id,
    v_schedule.id,
    v_account_id,
    v_amount,
    v_principal,
    v_interest,
    v_fees,
    v_penalty,
    v_contract.currency,
    (p_input ->> 'financialDate')::date,
    nullif(btrim(p_input ->> 'note'), ''),
    v_mutation_id,
    v_user_id,
    p_input
  )
  returning id into v_payment_id;

  insert into public.installment_cash_movements (
    workspace_id,
    account_id,
    payment_id,
    amount,
    currency,
    financial_date
  )
  values (
    v_workspace_id,
    v_account_id,
    v_payment_id,
    v_amount,
    v_contract.currency,
    (p_input ->> 'financialDate')::date
  );

  if v_interest > 0 then
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
    values (
      v_workspace_id,
      v_account_id,
      v_contract.interest_category_id,
      'expense',
      v_interest,
      v_contract.currency,
      v_interest,
      v_contract.currency,
      1,
      (p_input ->> 'financialDate')::date,
      coalesce(nullif(btrim(p_input ->> 'note'), ''), 'Installment interest'),
      gen_random_uuid(),
      v_user_id
    )
    returning id into v_expense_transaction_id;
    insert into public.installment_transaction_links (
      transaction_id,
      payment_id
    )
    values (v_expense_transaction_id, v_payment_id);
  end if;
  if v_fees + v_penalty > 0 then
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
    values (
      v_workspace_id,
      v_account_id,
      v_contract.expense_category_id,
      'expense',
      v_fees + v_penalty,
      v_contract.currency,
      v_fees + v_penalty,
      v_contract.currency,
      1,
      (p_input ->> 'financialDate')::date,
      coalesce(nullif(btrim(p_input ->> 'note'), ''), 'Installment fees'),
      gen_random_uuid(),
      v_user_id
    )
    returning id into v_expense_transaction_id;
    insert into public.installment_transaction_links (
      transaction_id,
      payment_id
    )
    values (v_expense_transaction_id, v_payment_id);
  end if;

  select jsonb_build_object(
    'paymentId', v_payment_id,
    'allocation', jsonb_build_object(
      'penalty', public.format_money(v_penalty, v_contract.currency),
      'fees', public.format_money(v_fees, v_contract.currency),
      'interest', public.format_money(v_interest, v_contract.currency),
      'principal', public.format_money(v_principal, v_contract.currency),
      'total', public.format_money(v_amount, v_contract.currency)
    ),
    'reportableExpense', public.format_money(
      v_reportable,
      v_contract.currency
    ),
    'scheduleStatus', v_schedule_status,
    'contractStatus', v_contract_status,
    'contractVersion', v_contract.version + 1,
    'accountBalance', jsonb_build_object(
      'accountId', balance.account_id,
      'amount', public.format_money(balance.amount, balance.currency),
      'currency', balance.currency
    )
  )
  into v_response
  from public.account_balances balance
  where balance.account_id = v_account_id;

  update public.installment_payments
  set response_json = v_response
  where id = v_payment_id;
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
    'installment.payment_posted',
    'installment_payment',
    v_payment_id
  );
  return jsonb_build_object(
    'response', v_response,
    'replayed', false
  );
end;
$$;

create function public.post_installment_payoff(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid := (p_input ->> 'workspaceId')::uuid;
  v_contract_id uuid := (p_input ->> 'contractId')::uuid;
  v_account_id uuid := (p_input ->> 'accountId')::uuid;
  v_mutation_id uuid := (p_input ->> 'clientMutationId')::uuid;
  v_action public.installment_payoff_action :=
    (p_input ->> 'action')::public.installment_payoff_action;
  v_expected_version integer :=
    (p_input ->> 'expectedVersion')::integer;
  v_expected_principal numeric(20, 4) :=
    (p_input ->> 'expectedRemainingPrincipal')::numeric;
  v_principal numeric(20, 4) :=
    (p_input ->> 'principalPayment')::numeric;
  v_interest numeric(20, 4) :=
    (p_input ->> 'quotedInterest')::numeric;
  v_fees numeric(20, 4) :=
    (p_input ->> 'quotedFees')::numeric;
  v_total numeric(20, 4) :=
    (p_input ->> 'totalCashRequired')::numeric;
  v_remaining numeric(20, 4) :=
    (p_input ->> 'remainingPrincipal')::numeric;
  v_interest_saved numeric(20, 4) :=
    (p_input ->> 'interestSaved')::numeric;
  v_canonical_request jsonb :=
    p_input
      - 'principalPayment'
      - 'totalCashRequired'
      - 'remainingPrincipal'
      - 'interestSaved'
      - 'regeneratedRows';
  v_contract public.installment_contracts%rowtype;
  v_payoff_id uuid;
  v_expense_transaction_id uuid;
  v_balance numeric(20, 4);
  v_actual_principal numeric(20, 4);
  v_scheduled_interest numeric(20, 4);
  v_scheduled_fees numeric(20, 4);
  v_first_sequence integer;
  v_first_due_date date;
  v_unpaid_count integer;
  v_existing_workspace_id uuid;
  v_existing_contract_id uuid;
  v_existing_request jsonb;
  v_existing_response jsonb;
  v_prior_schedule jsonb;
  v_contract_status public.installment_contract_status;
  v_response jsonb;
  v_row jsonb;
  v_row_count integer := 0;
  v_regenerated_principal numeric(20, 4) := 0;
  v_regenerated_interest numeric(20, 4) := 0;
  v_regenerated_fees numeric(20, 4) := 0;
  v_previous_sequence integer;
  v_previous_due_date date;
  v_previous_closing numeric(20, 4);
  v_scale integer;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  perform pg_advisory_xact_lock(
    hashtext(v_user_id::text || ':' || v_mutation_id::text)
  );
  select workspace_id, contract_id, request_json, response_json
  into
    v_existing_workspace_id,
    v_existing_contract_id,
    v_existing_request,
    v_existing_response
  from public.installment_payoffs
  where created_by = v_user_id
    and client_mutation_id = v_mutation_id;
  if found then
    if v_existing_workspace_id <> v_workspace_id
      or v_existing_contract_id <> v_contract_id
      or v_existing_request <> v_canonical_request
    then
      raise exception using errcode = '22023', message = 'mutation payload mismatch';
    end if;
    if coalesce(
      public.workspace_role_for(v_workspace_id)::text,
      ''
    ) not in ('owner', 'editor')
    then
      raise exception using errcode = '42501', message = 'workspace access denied';
    end if;
    return jsonb_build_object(
      'response', v_existing_response,
      'replayed', true
    );
  end if;

  select * into v_contract
  from public.installment_contracts
  where id = v_contract_id
    and workspace_id = v_workspace_id
  for update;
  if not found
    or v_contract.status <> 'active'
    or coalesce(
      public.workspace_role_for(v_workspace_id)::text,
      ''
    ) not in ('owner', 'editor')
  then
    raise exception using errcode = '42501', message = 'installment access denied';
  end if;
  if v_contract.version <> v_expected_version then
    raise exception using errcode = '40001', message = 'stale version';
  end if;
  if v_contract.currency <> p_input ->> 'currency'
    or v_principal is null
    or v_total is null
    or v_remaining is null
    or v_interest_saved is null
    or v_principal <= 0
    or v_interest < 0
    or v_fees < 0
    or v_total <> v_principal + v_interest + v_fees
    or (v_action = 'payoff' and v_remaining <> 0)
    or (
      v_action = 'extra_principal'
      and (
        not (p_input ? 'strategy')
        or not (p_input ? 'extraPrincipal')
        or v_interest <> 0
        or v_fees <> 0
        or v_total <> v_principal
        or jsonb_typeof(p_input -> 'regeneratedRows') <> 'array'
        or jsonb_array_length(p_input -> 'regeneratedRows') = 0
      )
    )
  then
    raise exception using errcode = '22023', message = 'invalid payoff quote';
  end if;

  perform 1
  from public.accounts account
  where account.id = v_account_id
    and account.workspace_id = v_workspace_id
    and account.currency = v_contract.currency
    and account.type in ('cash', 'bank', 'ewallet')
    and account.archived_at is null
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'invalid payment account';
  end if;
  select amount into v_balance
  from public.account_balances
  where account_id = v_account_id;
  if v_balance < v_total then
    raise exception using errcode = '22000', message = 'insufficient balance';
  end if;

  select
    coalesce(sum(scheduled_principal - paid_principal), 0),
    coalesce(sum(scheduled_interest - paid_interest), 0),
    coalesce(
      sum(
        scheduled_fees - paid_fees
          + scheduled_penalty - paid_penalty
      ),
      0
    ),
    min(sequence),
    min(due_date),
    count(*)::integer
  into
    v_actual_principal,
    v_scheduled_interest,
    v_scheduled_fees,
    v_first_sequence,
    v_first_due_date,
    v_unpaid_count
  from public.installment_schedule_rows
  where contract_id = v_contract_id
    and status not in ('paid', 'cancelled', 'waived');
  if v_actual_principal <> v_expected_principal
    or (
      v_action = 'payoff'
      and v_principal <> v_actual_principal
    )
    or (
      v_action = 'extra_principal'
      and (
        v_principal >= v_actual_principal
        or v_principal <>
          (p_input ->> 'extraPrincipal')::numeric
        or v_remaining <> v_actual_principal - v_principal
      )
    )
  then
    raise exception using errcode = '40001', message = 'stale principal quote';
  end if;

  if v_action = 'payoff' then
    if v_interest_saved <>
      greatest(v_scheduled_interest - v_interest, 0)
    then
      raise exception using errcode = '22023', message = 'invalid payoff savings';
    end if;
  else
    v_scale := case
      when v_contract.currency in ('JPY', 'KRW', 'VND', 'CLP', 'ISK')
        then 0
      when v_contract.currency in ('BHD', 'KWD', 'OMR', 'JOD', 'TND', 'LYD')
        then 3
      when v_contract.currency = 'CLF' then 4
      else 2
    end;
    for v_row in
      select value
      from jsonb_array_elements(p_input -> 'regeneratedRows')
      order by (value ->> 'sequence')::integer
    loop
      v_row_count := v_row_count + 1;
      if (v_row ->> 'principal')::numeric < 0
        or (v_row ->> 'interest')::numeric < 0
        or (v_row ->> 'fees')::numeric < 0
        or (v_row ->> 'openingPrincipal')::numeric < 0
        or (v_row ->> 'closingPrincipal')::numeric < 0
        or (v_row ->> 'total')::numeric <>
          (v_row ->> 'principal')::numeric
            + (v_row ->> 'interest')::numeric
            + (v_row ->> 'fees')::numeric
        or (v_row ->> 'openingPrincipal')::numeric
            - (v_row ->> 'principal')::numeric
          <> (v_row ->> 'closingPrincipal')::numeric
        or (
          v_row_count = 1
          and (
            (v_row ->> 'sequence')::integer <> v_first_sequence
            or (v_row ->> 'dueDate')::date <> v_first_due_date
            or (v_row ->> 'openingPrincipal')::numeric <> v_remaining
          )
        )
        or (
          v_previous_sequence is not null
          and (
            (v_row ->> 'sequence')::integer
              <> v_previous_sequence + 1
            or (v_row ->> 'dueDate')::date <= v_previous_due_date
            or (v_row ->> 'openingPrincipal')::numeric
              <> v_previous_closing
          )
        )
        or (
          v_contract.interest_method = 'reducing'
          and (v_row ->> 'interest')::numeric <>
            round(
              (v_row ->> 'openingPrincipal')::numeric
                * v_contract.annual_rate / 1200,
              v_scale
            )
        )
      then
        raise exception using errcode = '22023', message = 'invalid regenerated schedule';
      end if;
      v_regenerated_principal :=
        v_regenerated_principal + (v_row ->> 'principal')::numeric;
      v_regenerated_interest :=
        v_regenerated_interest + (v_row ->> 'interest')::numeric;
      v_regenerated_fees :=
        v_regenerated_fees + (v_row ->> 'fees')::numeric;
      v_previous_sequence := (v_row ->> 'sequence')::integer;
      v_previous_due_date := (v_row ->> 'dueDate')::date;
      v_previous_closing :=
        (v_row ->> 'closingPrincipal')::numeric;
    end loop;
    if v_regenerated_principal <> v_remaining
      or v_previous_closing <> 0
      or v_regenerated_fees <> v_scheduled_fees
      or (
        v_contract.interest_method <> 'reducing'
        and v_regenerated_interest <> v_scheduled_interest
      )
      or (
        (p_input ->> 'strategy') = 'reduce_payment'
        and v_row_count <> v_unpaid_count
      )
      or (
        (p_input ->> 'strategy') = 'shorten_term'
        and v_row_count > v_unpaid_count
      )
      or v_interest_saved <>
        greatest(v_scheduled_interest - v_regenerated_interest, 0)
    then
      raise exception using errcode = '22023', message = 'regenerated schedule mismatch';
    end if;
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(schedule) order by schedule.sequence),
    '[]'::jsonb
  )
  into v_prior_schedule
  from public.installment_schedule_rows schedule
  where schedule.contract_id = v_contract_id
    and schedule.status not in ('paid', 'cancelled', 'waived');

  if v_action = 'payoff' then
    update public.installment_schedule_rows
    set status = 'cancelled', updated_at = now()
    where contract_id = v_contract_id
      and status not in ('paid', 'cancelled', 'waived');
    v_contract_status := 'paid_off';
  else
    update public.installment_schedule_rows
    set status = 'cancelled', updated_at = now()
    where contract_id = v_contract_id
      and status not in ('paid', 'cancelled', 'waived');
    insert into public.installment_schedule_rows (
      contract_id,
      workspace_id,
      sequence,
      due_date,
      opening_principal,
      scheduled_principal,
      scheduled_interest,
      scheduled_fees,
      closing_principal
    )
    select
      v_contract_id,
      v_workspace_id,
      (row ->> 'sequence')::integer,
      (row ->> 'dueDate')::date,
      (row ->> 'openingPrincipal')::numeric,
      (row ->> 'principal')::numeric,
      (row ->> 'interest')::numeric,
      (row ->> 'fees')::numeric,
      (row ->> 'closingPrincipal')::numeric
    from jsonb_array_elements(p_input -> 'regeneratedRows') row;
    v_contract_status := 'active';
  end if;

  update public.installment_contracts
  set
    status = v_contract_status,
    version = version + 1,
    updated_at = now()
  where id = v_contract_id;

  insert into public.installment_payoffs (
    workspace_id,
    contract_id,
    account_id,
    action,
    strategy,
    principal_payment,
    interest_due,
    fees_due,
    total_cash_required,
    remaining_principal,
    interest_saved,
    currency,
    financial_date,
    note,
    prior_schedule,
    client_mutation_id,
    created_by,
    request_json
  )
  values (
    v_workspace_id,
    v_contract_id,
    v_account_id,
    v_action,
    nullif(p_input ->> 'strategy', '')::public.installment_extra_strategy,
    v_principal,
    v_interest,
    v_fees,
    v_total,
    v_remaining,
    v_interest_saved,
    v_contract.currency,
    (p_input ->> 'financialDate')::date,
    nullif(btrim(p_input ->> 'note'), ''),
    v_prior_schedule,
    v_mutation_id,
    v_user_id,
    v_canonical_request
  )
  returning id into v_payoff_id;

  insert into public.installment_cash_movements (
    workspace_id,
    account_id,
    payoff_id,
    amount,
    currency,
    financial_date
  )
  values (
    v_workspace_id,
    v_account_id,
    v_payoff_id,
    v_total,
    v_contract.currency,
    (p_input ->> 'financialDate')::date
  );

  if v_interest > 0 then
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
    values (
      v_workspace_id,
      v_account_id,
      v_contract.interest_category_id,
      'expense',
      v_interest,
      v_contract.currency,
      v_interest,
      v_contract.currency,
      1,
      (p_input ->> 'financialDate')::date,
      coalesce(nullif(btrim(p_input ->> 'note'), ''), 'Installment payoff interest'),
      gen_random_uuid(),
      v_user_id
    )
    returning id into v_expense_transaction_id;
    insert into public.installment_transaction_links (
      transaction_id,
      payoff_id
    )
    values (v_expense_transaction_id, v_payoff_id);
  end if;
  if v_fees > 0 then
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
    values (
      v_workspace_id,
      v_account_id,
      v_contract.expense_category_id,
      'expense',
      v_fees,
      v_contract.currency,
      v_fees,
      v_contract.currency,
      1,
      (p_input ->> 'financialDate')::date,
      coalesce(nullif(btrim(p_input ->> 'note'), ''), 'Installment payoff fees'),
      gen_random_uuid(),
      v_user_id
    )
    returning id into v_expense_transaction_id;
    insert into public.installment_transaction_links (
      transaction_id,
      payoff_id
    )
    values (v_expense_transaction_id, v_payoff_id);
  end if;

  select jsonb_build_object(
    'payoffId', v_payoff_id,
    'action', v_action,
    'strategy', nullif(p_input ->> 'strategy', ''),
    'principalPayment', public.format_money(
      v_principal,
      v_contract.currency
    ),
    'interestDue', public.format_money(
      v_interest,
      v_contract.currency
    ),
    'feesDue', public.format_money(v_fees, v_contract.currency),
    'reportableExpense', public.format_money(
      v_interest + v_fees,
      v_contract.currency
    ),
    'totalCashRequired', public.format_money(
      v_total,
      v_contract.currency
    ),
    'remainingPrincipal', public.format_money(
      v_remaining,
      v_contract.currency
    ),
    'interestSaved', public.format_money(
      v_interest_saved,
      v_contract.currency
    ),
    'contractStatus', v_contract_status,
    'contractVersion', v_contract.version + 1,
    'accountBalance', jsonb_build_object(
      'accountId', balance.account_id,
      'amount', public.format_money(balance.amount, balance.currency),
      'currency', balance.currency
    )
  )
  into v_response
  from public.account_balances balance
  where balance.account_id = v_account_id;

  update public.installment_payoffs
  set response_json = v_response
  where id = v_payoff_id;
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
    'installment.payoff_posted',
    'installment_payoff',
    v_payoff_id
  );
  return jsonb_build_object(
    'response', v_response,
    'replayed', false
  );
end;
$$;

revoke all on function public.installment_contract_response(uuid)
  from public;
revoke all on function public.create_installment_contract(jsonb)
  from public;
revoke all on function public.post_installment_payment(jsonb)
  from public;
revoke all on function public.post_installment_payoff(jsonb)
  from public;

grant execute on function public.create_installment_contract(jsonb)
  to authenticated;
grant execute on function public.post_installment_payment(jsonb)
  to authenticated;
grant execute on function public.post_installment_payoff(jsonb)
  to authenticated;

grant select on public.installment_contracts to authenticated;
grant select on public.installment_schedule_rows to authenticated;
grant select on public.installment_payments to authenticated;
grant select on public.installment_payoffs to authenticated;
grant select on public.installment_cash_movements to authenticated;
grant select on public.installment_transaction_links to authenticated;
