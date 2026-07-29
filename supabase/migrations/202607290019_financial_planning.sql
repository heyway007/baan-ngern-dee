create type public.savings_goal_status as enum ('active', 'archived');

create table public.monthly_budget_allocations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.workspaces (id) on delete cascade,
  category_id uuid not null references public.categories (id),
  month date not null
    check (month = date_trunc('month', month)::date),
  amount numeric(20, 4) not null check (amount >= 0),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  version integer not null default 1 check (version > 0),
  unique (workspace_id, category_id, month)
);

create table public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  target_amount numeric(20, 4) not null check (target_amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  target_date date,
  account_id uuid not null references public.accounts (id),
  status public.savings_goal_status not null default 'active',
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  version integer not null default 1 check (version > 0)
);

create unique index one_active_savings_goal_per_account
  on public.savings_goals (workspace_id, account_id)
  where status = 'active';

alter table public.monthly_budget_allocations enable row level security;
alter table public.savings_goals enable row level security;

create policy monthly_budget_select_member
on public.monthly_budget_allocations for select
using (public.is_workspace_member(workspace_id));

create policy savings_goal_select_member
on public.savings_goals for select
using (public.is_workspace_member(workspace_id));

create function public.monthly_budget_json(p_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', allocation.id,
    'workspaceId', allocation.workspace_id,
    'categoryId', allocation.category_id,
    'month', to_char(allocation.month, 'YYYY-MM'),
    'amount', public.format_money(allocation.amount, workspace.base_currency),
    'removedAt', allocation.removed_at,
    'version', allocation.version
  ))
  from public.monthly_budget_allocations allocation
  join public.workspaces workspace on workspace.id = allocation.workspace_id
  where allocation.id = p_id
$$;

create function public.savings_goal_json(p_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', goal.id,
    'workspaceId', goal.workspace_id,
    'name', goal.name,
    'targetAmount', public.format_money(goal.target_amount, goal.currency),
    'currency', goal.currency,
    'targetDate', goal.target_date,
    'accountId', goal.account_id,
    'accountType', account.type,
    'status', goal.status,
    'version', goal.version
  ))
  from public.savings_goals goal
  join public.accounts account on account.id = goal.account_id
  where goal.id = p_id
$$;

create function public.require_planning_editor(p_workspace_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'authentication required';
  end if;
  if coalesce(public.workspace_role_for(p_workspace_id)::text, '')
    not in ('owner', 'editor')
  then
    raise exception using
      errcode = '42501',
      message = 'workspace access denied';
  end if;
end;
$$;

create function public.set_monthly_budget(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace_id uuid := (p_input ->> 'workspaceId')::uuid;
  v_category_id uuid := (p_input ->> 'categoryId')::uuid;
  v_month date;
  v_amount numeric;
  v_expected_version integer;
  v_id uuid;
begin
  perform public.require_planning_editor(v_workspace_id);
  if coalesce(p_input ->> 'month', '') !~ '^\d{4}-(0[1-9]|1[0-2])$'
    or coalesce(p_input ->> 'amount', '') !~
      '^(0|[1-9]\d*)(\.\d{1,4})?$'
  then
    raise exception using errcode = '22023', message = 'invalid budget';
  end if;
  v_month := ((p_input ->> 'month') || '-01')::date;
  v_amount := (p_input ->> 'amount')::numeric;
  if v_amount <= 0 or not exists (
    select 1 from public.categories category
    where category.id = v_category_id
      and category.workspace_id = v_workspace_id
      and category.kind = 'expense'
      and category.archived_at is null
  ) then
    raise exception using errcode = '22023', message = 'invalid budget';
  end if;

  if p_input ? 'version' then
    v_expected_version := (p_input ->> 'version')::integer;
    update public.monthly_budget_allocations
    set amount = v_amount,
        removed_at = null,
        updated_at = now(),
        version = version + 1
    where workspace_id = v_workspace_id
      and category_id = v_category_id
      and month = v_month
      and version = v_expected_version
    returning id into v_id;
    if v_id is null then
      raise exception using errcode = '40001', message = 'stale version';
    end if;
  else
    begin
      insert into public.monthly_budget_allocations (
        workspace_id, category_id, month, amount, created_by
      ) values (
        v_workspace_id, v_category_id, v_month, v_amount, auth.uid()
      ) returning id into v_id;
    exception when unique_violation then
      raise exception using errcode = '23505', message = 'budget already exists';
    end;
  end if;

  insert into public.audit_events (
    workspace_id, actor_user_id, action, entity_type, entity_id
  ) values (
    v_workspace_id, auth.uid(), 'budget.set',
    'monthly_budget_allocation', v_id
  );
  return public.monthly_budget_json(v_id);
end;
$$;

create function public.remove_monthly_budget(
  p_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace_id uuid;
begin
  select workspace_id into v_workspace_id
  from public.monthly_budget_allocations where id = p_id;
  perform public.require_planning_editor(v_workspace_id);
  update public.monthly_budget_allocations
  set amount = 0,
      removed_at = now(),
      updated_at = now(),
      version = version + 1
  where id = p_id
    and version = p_expected_version;
  if not found then
    raise exception using errcode = '40001', message = 'stale version';
  end if;
  insert into public.audit_events (
    workspace_id, actor_user_id, action, entity_type, entity_id
  ) values (
    v_workspace_id, auth.uid(), 'budget.removed',
    'monthly_budget_allocation', p_id
  );
  return public.monthly_budget_json(p_id);
end;
$$;

create function public.initialize_budget_month(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace_id uuid := (p_input ->> 'workspaceId')::uuid;
  v_month date;
  v_count integer;
begin
  perform public.require_planning_editor(v_workspace_id);
  if coalesce(p_input ->> 'month', '') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception using errcode = '22023', message = 'invalid month';
  end if;
  v_month := ((p_input ->> 'month') || '-01')::date;
  insert into public.monthly_budget_allocations (
    workspace_id, category_id, month, amount, created_by
  )
  select
    previous.workspace_id,
    previous.category_id,
    v_month,
    previous.amount,
    auth.uid()
  from public.monthly_budget_allocations previous
  join public.categories category
    on category.id = previous.category_id
   and category.archived_at is null
  where previous.workspace_id = v_workspace_id
    and previous.month = (v_month - interval '1 month')::date
    and previous.removed_at is null
    and previous.amount > 0
  on conflict (workspace_id, category_id, month) do nothing;
  get diagnostics v_count = row_count;
  if v_count > 0 then
    insert into public.audit_events (
      workspace_id, actor_user_id, action, entity_type, entity_id,
      safe_metadata
    ) values (
      v_workspace_id, auth.uid(), 'budget.month_initialized',
      'workspace', v_workspace_id,
      jsonb_build_object('month', to_char(v_month, 'YYYY-MM'))
    );
  end if;
  return jsonb_build_object('createdCount', v_count);
end;
$$;

create function public.validate_savings_goal_destination(
  p_workspace_id uuid,
  p_account_id uuid,
  p_currency text
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.accounts account
    join public.workspaces workspace on workspace.id = account.workspace_id
    where account.id = p_account_id
      and account.workspace_id = p_workspace_id
      and account.type in ('cash', 'bank', 'ewallet', 'asset')
      and account.currency = p_currency
      and workspace.base_currency = p_currency
      and account.archived_at is null
  ) then
    raise exception using
      errcode = '22023',
      message = 'invalid savings account';
  end if;
end;
$$;

create function public.create_savings_goal(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace_id uuid := (p_input ->> 'workspaceId')::uuid;
  v_account_id uuid := (p_input ->> 'accountId')::uuid;
  v_currency text := p_input ->> 'currency';
  v_target numeric;
  v_id uuid;
begin
  perform public.require_planning_editor(v_workspace_id);
  perform public.validate_savings_goal_destination(
    v_workspace_id, v_account_id, v_currency
  );
  if char_length(btrim(coalesce(p_input ->> 'name', ''))) not between 1 and 100
    or coalesce(p_input ->> 'targetAmount', '') !~
      '^(0|[1-9]\d*)(\.\d{1,4})?$'
  then
    raise exception using errcode = '22023', message = 'invalid savings goal';
  end if;
  v_target := (p_input ->> 'targetAmount')::numeric;
  if v_target <= 0 then
    raise exception using errcode = '22023', message = 'invalid savings goal';
  end if;
  begin
    insert into public.savings_goals (
      workspace_id, name, target_amount, currency, target_date,
      account_id, created_by
    ) values (
      v_workspace_id,
      btrim(p_input ->> 'name'),
      v_target,
      v_currency,
      nullif(p_input ->> 'targetDate', '')::date,
      v_account_id,
      auth.uid()
    ) returning id into v_id;
  exception when unique_violation then
    raise exception using
      errcode = '23505',
      message = 'account already linked to an active savings goal';
  end;
  insert into public.audit_events (
    workspace_id, actor_user_id, action, entity_type, entity_id
  ) values (
    v_workspace_id, auth.uid(), 'savings_goal.created',
    'savings_goal', v_id
  );
  return public.savings_goal_json(v_id);
end;
$$;

create function public.update_savings_goal(p_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace_id uuid;
  v_account_id uuid := (p_input ->> 'accountId')::uuid;
  v_currency text := p_input ->> 'currency';
  v_target numeric := (p_input ->> 'targetAmount')::numeric;
begin
  select workspace_id into v_workspace_id
  from public.savings_goals where id = p_id and status = 'active';
  perform public.require_planning_editor(v_workspace_id);
  perform public.validate_savings_goal_destination(
    v_workspace_id, v_account_id, v_currency
  );
  if char_length(btrim(coalesce(p_input ->> 'name', ''))) not between 1 and 100
    or v_target <= 0
  then
    raise exception using errcode = '22023', message = 'invalid savings goal';
  end if;
  begin
    update public.savings_goals
    set name = btrim(p_input ->> 'name'),
        target_amount = v_target,
        currency = v_currency,
        target_date = nullif(p_input ->> 'targetDate', '')::date,
        account_id = v_account_id,
        updated_at = now(),
        version = version + 1
    where id = p_id
      and status = 'active'
      and version = (p_input ->> 'version')::integer;
  exception when unique_violation then
    raise exception using
      errcode = '23505',
      message = 'account already linked to an active savings goal';
  end;
  if not found then
    raise exception using errcode = '40001', message = 'stale version';
  end if;
  insert into public.audit_events (
    workspace_id, actor_user_id, action, entity_type, entity_id
  ) values (
    v_workspace_id, auth.uid(), 'savings_goal.updated',
    'savings_goal', p_id
  );
  return public.savings_goal_json(p_id);
end;
$$;

create function public.archive_savings_goal(
  p_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace_id uuid;
begin
  select workspace_id into v_workspace_id
  from public.savings_goals where id = p_id;
  perform public.require_planning_editor(v_workspace_id);
  update public.savings_goals
  set status = 'archived',
      archived_at = now(),
      updated_at = now(),
      version = version + 1
  where id = p_id
    and status = 'active'
    and version = p_expected_version;
  if not found then
    raise exception using errcode = '40001', message = 'stale version';
  end if;
  insert into public.audit_events (
    workspace_id, actor_user_id, action, entity_type, entity_id
  ) values (
    v_workspace_id, auth.uid(), 'savings_goal.archived',
    'savings_goal', p_id
  );
  return public.savings_goal_json(p_id);
end;
$$;

create function public.get_financial_plan(
  p_workspace_id uuid,
  p_month text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_month date;
  v_currency text;
  v_result jsonb;
begin
  if not public.is_workspace_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace access denied';
  end if;
  if coalesce(p_month, '') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception using errcode = '22023', message = 'invalid month';
  end if;
  v_month := (p_month || '-01')::date;
  select base_currency into v_currency
  from public.workspaces where id = p_workspace_id and archived_at is null;

  with expense_facts as (
    select
      coalesce(transaction.category_id, split.category_id) category_id,
      date_trunc('month', transaction.financial_date)::date
        as financial_month,
      case
        when transaction.category_id is not null then transaction.base_amount
        else transaction.base_amount * split.amount /
          nullif(transaction.amount, 0)
      end base_amount
    from public.transactions transaction
    left join public.transaction_splits split
      on split.transaction_id = transaction.id
    where transaction.workspace_id = p_workspace_id
      and transaction.type = 'expense'
      and transaction.state = 'posted'
  ),
  spending as (
    select category_id, financial_month, sum(base_amount) amount
    from expense_facts
    where category_id is not null
    group by category_id, financial_month
  ),
  relevant_categories as (
    select distinct category_id
    from public.monthly_budget_allocations
    where workspace_id = p_workspace_id and month <= v_month
    union
    select category_id from spending where financial_month = v_month
  ),
  raw_rows as (
    select
      category.id category_id,
      category.name category_name,
      current_allocation.id allocation_id,
      current_allocation.version allocation_version,
      (
        current_allocation.id is not null
        and current_allocation.removed_at is null
        and current_allocation.amount > 0
      ) is_budgeted,
      case
        when current_allocation.removed_at is null
          then coalesce(current_allocation.amount, 0)
        else 0
      end base_budget,
      case when first_allocation.first_month is null then 0 else
        coalesce((
          select sum(case when allocation.removed_at is null
            then allocation.amount else 0 end)
          from public.monthly_budget_allocations allocation
          where allocation.workspace_id = p_workspace_id
            and allocation.category_id = category.id
            and allocation.month < v_month
        ), 0)
        - coalesce((
          select sum(spending.amount) from spending
          where spending.category_id = category.id
            and spending.financial_month >= first_allocation.first_month
            and spending.financial_month < v_month
        ), 0)
      end prior_carry,
      coalesce(current_spending.amount, 0) spent
    from relevant_categories relevant
    join public.categories category on category.id = relevant.category_id
    left join public.monthly_budget_allocations current_allocation
      on current_allocation.workspace_id = p_workspace_id
     and current_allocation.category_id = category.id
     and current_allocation.month = v_month
    left join lateral (
      select min(allocation.month) first_month
      from public.monthly_budget_allocations allocation
      where allocation.workspace_id = p_workspace_id
        and allocation.category_id = category.id
    ) first_allocation on true
    left join spending current_spending
      on current_spending.category_id = category.id
     and current_spending.financial_month = v_month
  ),
  category_rows as (
    select *,
      base_budget + prior_carry available,
      base_budget + prior_carry - spent remaining
    from raw_rows
  ),
  totals as (
    select
      coalesce(sum(base_budget), 0) base_budget,
      coalesce(sum(prior_carry), 0) prior_carry,
      coalesce(sum(available), 0) available,
      coalesce(sum(spent), 0) spent,
      coalesce(sum(remaining), 0) remaining
    from category_rows
  ),
  categories_json as (
    select coalesce(jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'categoryId', category_id,
        'categoryName', category_name,
        'allocationId', allocation_id,
        'allocationVersion', allocation_version,
        'isBudgeted', is_budgeted,
        'baseBudget', public.format_money(base_budget, v_currency),
        'priorCarry', public.format_money(prior_carry, v_currency),
        'available', public.format_money(available, v_currency),
        'spent', public.format_money(spent, v_currency),
        'remaining', public.format_money(remaining, v_currency)
      )) order by is_budgeted desc, category_name
    ), '[]'::jsonb) value from category_rows
  ),
  goals_json as (
    select coalesce(jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'id', goal.id,
        'name', goal.name,
        'accountId', goal.account_id,
        'accountName', account.name,
        'currentAmount', public.format_money(
          greatest(coalesce(balance.amount, 0), 0), goal.currency
        ),
        'targetAmount', public.format_money(goal.target_amount, goal.currency),
        'currency', goal.currency,
        'targetDate', goal.target_date,
        'percent', least(100, round(
          greatest(coalesce(balance.amount, 0), 0)
          / goal.target_amount * 100, 2
        )),
        'reached', coalesce(balance.amount, 0) >= goal.target_amount,
        'accountArchived', account.archived_at is not null,
        'status', goal.status,
        'version', goal.version
      )) order by (goal.status = 'active') desc, goal.created_at
    ), '[]'::jsonb) value
    from public.savings_goals goal
    join public.accounts account on account.id = goal.account_id
    left join public.account_balances balance
      on balance.account_id = goal.account_id
    where goal.workspace_id = p_workspace_id
  )
  select jsonb_build_object(
    'workspaceId', p_workspace_id,
    'month', p_month,
    'currency', v_currency,
    'totals', jsonb_build_object(
      'baseBudget', public.format_money(totals.base_budget, v_currency),
      'priorCarry', public.format_money(totals.prior_carry, v_currency),
      'available', public.format_money(totals.available, v_currency),
      'spent', public.format_money(totals.spent, v_currency),
      'remaining', public.format_money(totals.remaining, v_currency)
    ),
    'categories', categories_json.value,
    'goals', goals_json.value
  ) into v_result
  from totals cross join categories_json cross join goals_json;
  return v_result;
end;
$$;

create function public.snapshot_budget_allocations(p_workspace_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(
    public.monthly_budget_json(allocation.id)
    order by allocation.month, allocation.category_id
  ), '[]'::jsonb)
  from public.monthly_budget_allocations allocation
  where p_workspace_id is not null
    and allocation.workspace_id = p_workspace_id
$$;

create function public.snapshot_savings_goals(p_workspace_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(
    public.savings_goal_json(goal.id)
    order by goal.created_at, goal.id
  ), '[]'::jsonb)
  from public.savings_goals goal
  where p_workspace_id is not null
    and goal.workspace_id = p_workspace_id
$$;

create or replace function public.get_finance_snapshot()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with selected_workspace as (
    select
      workspace.id, workspace.name, workspace.kind,
      workspace.base_currency, workspace.timezone, workspace.version,
      member.role
    from public.workspaces workspace
    join public.workspace_members member
      on member.workspace_id = workspace.id
     and member.user_id = auth.uid()
    where workspace.archived_at is null
    order by (workspace.kind = 'private') desc,
      workspace.created_at, workspace.id
    limit 1
  )
  select jsonb_build_object(
    'version', 1,
    'workspace', case when workspace.id is null then null else
      jsonb_build_object(
        'id', workspace.id, 'name', workspace.name,
        'kind', workspace.kind, 'baseCurrency', workspace.base_currency,
        'timeZone', workspace.timezone, 'role', workspace.role,
        'version', workspace.version
      ) end,
    'categories', public.snapshot_categories(workspace.id),
    'accounts', public.snapshot_accounts(workspace.id),
    'accountBalances', public.snapshot_account_balances(workspace.id),
    'openingTransactions', public.snapshot_opening_transactions(workspace.id),
    'transactions', public.snapshot_transactions(workspace.id),
    'installmentContracts', public.snapshot_installment_contracts(workspace.id),
    'installmentSchedules', public.snapshot_installment_schedules(workspace.id),
    'installmentPayments', public.snapshot_installment_payments(workspace.id),
    'installmentPayoffs', public.snapshot_installment_payoffs(workspace.id),
    'recurringTemplates', public.snapshot_recurring_templates(workspace.id),
    'recurringOccurrences', public.snapshot_recurring_occurrences(
      workspace.id,
      date_trunc('month', now() at time zone workspace.timezone)::date
    ),
    'budgetAllocations', public.snapshot_budget_allocations(workspace.id),
    'savingsGoals', public.snapshot_savings_goals(workspace.id)
  )
  from (select true) singleton
  left join selected_workspace workspace on true
$$;

revoke all on table public.monthly_budget_allocations from public;
revoke all on table public.savings_goals from public;
grant select on public.monthly_budget_allocations to authenticated;
grant select on public.savings_goals to authenticated;

revoke all on function public.monthly_budget_json(uuid) from public;
revoke all on function public.savings_goal_json(uuid) from public;
revoke all on function public.require_planning_editor(uuid) from public;
revoke all on function public.validate_savings_goal_destination(uuid, uuid, text)
  from public;
revoke all on function public.set_monthly_budget(jsonb) from public;
revoke all on function public.remove_monthly_budget(uuid, integer) from public;
revoke all on function public.initialize_budget_month(jsonb) from public;
revoke all on function public.create_savings_goal(jsonb) from public;
revoke all on function public.update_savings_goal(uuid, jsonb) from public;
revoke all on function public.archive_savings_goal(uuid, integer) from public;
revoke all on function public.get_financial_plan(uuid, text) from public;
revoke all on function public.snapshot_budget_allocations(uuid) from public;
revoke all on function public.snapshot_savings_goals(uuid) from public;

grant execute on function public.set_monthly_budget(jsonb) to authenticated;
grant execute on function public.monthly_budget_json(uuid) to authenticated;
grant execute on function public.savings_goal_json(uuid) to authenticated;
grant execute on function public.remove_monthly_budget(uuid, integer)
  to authenticated;
grant execute on function public.initialize_budget_month(jsonb)
  to authenticated;
grant execute on function public.create_savings_goal(jsonb) to authenticated;
grant execute on function public.update_savings_goal(uuid, jsonb)
  to authenticated;
grant execute on function public.archive_savings_goal(uuid, integer)
  to authenticated;
grant execute on function public.get_financial_plan(uuid, text)
  to authenticated;
grant execute on function public.snapshot_budget_allocations(uuid)
  to authenticated;
grant execute on function public.snapshot_savings_goals(uuid)
  to authenticated;
