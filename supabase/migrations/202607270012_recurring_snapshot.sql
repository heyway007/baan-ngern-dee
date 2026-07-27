create function public.snapshot_recurring_templates(
  p_workspace_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      public.recurring_template_json(template.id)
      order by template.status, template.name, template.id
    ),
    '[]'::jsonb
  )
  from public.recurring_templates template
  where p_workspace_id is not null
    and template.workspace_id = p_workspace_id
$$;

create function public.snapshot_recurring_occurrences(
  p_workspace_id uuid,
  p_period date
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      public.recurring_occurrence_json(occurrence.id)
      order by occurrence.scheduled_date, template.name, occurrence.id
    ),
    '[]'::jsonb
  )
  from public.recurring_occurrences occurrence
  join public.recurring_templates template
    on template.id = occurrence.template_id
  where p_workspace_id is not null
    and p_period is not null
    and occurrence.workspace_id = p_workspace_id
    and occurrence.period_month = p_period
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
      workspace.id,
      workspace.name,
      workspace.kind,
      workspace.base_currency,
      workspace.timezone,
      workspace.version,
      member.role
    from public.workspaces workspace
    join public.workspace_members member
      on member.workspace_id = workspace.id
     and member.user_id = auth.uid()
    where workspace.archived_at is null
    order by
      (workspace.kind = 'private') desc,
      workspace.created_at,
      workspace.id
    limit 1
  )
  select jsonb_build_object(
    'version', 1,
    'workspace', case
      when workspace.id is null then null
      else jsonb_build_object(
        'id', workspace.id,
        'name', workspace.name,
        'kind', workspace.kind,
        'baseCurrency', workspace.base_currency,
        'timeZone', workspace.timezone,
        'role', workspace.role,
        'version', workspace.version
      )
    end,
    'categories', public.snapshot_categories(workspace.id),
    'accounts', public.snapshot_accounts(workspace.id),
    'accountBalances',
      public.snapshot_account_balances(workspace.id),
    'openingTransactions',
      public.snapshot_opening_transactions(workspace.id),
    'transactions', public.snapshot_transactions(workspace.id),
    'installmentContracts',
      public.snapshot_installment_contracts(workspace.id),
    'installmentSchedules',
      public.snapshot_installment_schedules(workspace.id),
    'installmentPayments',
      public.snapshot_installment_payments(workspace.id),
    'installmentPayoffs',
      public.snapshot_installment_payoffs(workspace.id),
    'recurringTemplates',
      public.snapshot_recurring_templates(workspace.id),
    'recurringOccurrences',
      public.snapshot_recurring_occurrences(
        workspace.id,
        date_trunc(
          'month',
          now() at time zone workspace.timezone
        )::date
      )
  )
  from (select true) singleton
  left join selected_workspace workspace on true
$$;

revoke all on function public.snapshot_recurring_templates(uuid)
  from public;
revoke all on function public.snapshot_recurring_occurrences(uuid, date)
  from public;

grant execute on function public.snapshot_recurring_templates(uuid)
  to authenticated;
grant execute on function public.snapshot_recurring_occurrences(uuid, date)
  to authenticated;
grant execute on function public.recurring_template_json(uuid)
  to authenticated;
grant execute on function public.recurring_occurrence_json(uuid)
  to authenticated;
