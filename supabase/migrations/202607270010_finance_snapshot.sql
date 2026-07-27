create function public.snapshot_categories(p_workspace_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_strip_nulls(
        jsonb_build_object(
          'id', category.id,
          'workspaceId', category.workspace_id,
          'parentId', category.parent_id,
          'slug', category.slug,
          'name', category.name,
          'kind', category.kind,
          'isDefault', category.is_default,
          'version', category.version
        )
      )
      order by category.kind, category.name, category.id
    ),
    '[]'::jsonb
  )
  from public.categories category
  where p_workspace_id is not null
    and category.workspace_id = p_workspace_id
    and category.archived_at is null
$$;

create function public.snapshot_accounts(p_workspace_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_strip_nulls(
        jsonb_build_object(
          'id', account.id,
          'workspaceId', account.workspace_id,
          'name', account.name,
          'type', account.type,
          'currency', account.currency,
          'institution', account.institution,
          'version', account.version
        )
      )
      order by account.created_at, account.id
    ),
    '[]'::jsonb
  )
  from public.accounts account
  where p_workspace_id is not null
    and account.workspace_id = p_workspace_id
    and account.archived_at is null
$$;

create function public.snapshot_account_balances(p_workspace_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_object_agg(
      balance.account_id::text,
      jsonb_build_object(
        'accountId', balance.account_id,
        'amount', public.format_money(
          balance.amount,
          balance.currency
        ),
        'currency', balance.currency
      )
      order by balance.account_id
    ),
    '{}'::jsonb
  )
  from public.account_balances balance
  join public.accounts account on account.id = balance.account_id
  where p_workspace_id is not null
    and balance.workspace_id = p_workspace_id
    and account.archived_at is null
$$;

create function public.snapshot_opening_transactions(p_workspace_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', tx.id,
        'workspaceId', tx.workspace_id,
        'accountId', tx.account_id,
        'amount', public.format_money(tx.amount, tx.currency),
        'currency', tx.currency,
        'state', tx.state,
        'version', tx.version
      )
      order by tx.financial_date, tx.created_at, tx.id
    ),
    '[]'::jsonb
  )
  from public.transactions tx
  where p_workspace_id is not null
    and tx.workspace_id = p_workspace_id
    and tx.type = 'balance_adjustment'
    and tx.state = 'posted'
$$;

create function public.snapshot_transactions(p_workspace_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_strip_nulls(
        jsonb_build_object(
          'id', tx.id,
          'workspaceId', tx.workspace_id,
          'accountId', tx.account_id,
          'type', tx.type,
          'amount', public.format_money(tx.amount, tx.currency),
          'currency', tx.currency,
          'financialDate', tx.financial_date,
          'categoryId', tx.category_id,
          'splits', case
            when tx.category_id is null then (
              select coalesce(
                jsonb_agg(
                  jsonb_strip_nulls(
                    jsonb_build_object(
                      'categoryId', split.category_id,
                      'amount', public.format_money(
                        split.amount,
                        tx.currency
                      ),
                      'note', split.note
                    )
                  )
                  order by split.position, split.id
                ),
                '[]'::jsonb
              )
              from public.transaction_splits split
              where split.transaction_id = tx.id
            )
            else null
          end,
          'note', tx.note,
          'tagIds', (
            select coalesce(
              jsonb_agg(tag.tag_id order by tag.tag_id),
              '[]'::jsonb
            )
            from public.transaction_tags tag
            where tag.transaction_id = tx.id
          ),
          'state', tx.state,
          'version', tx.version,
          'createdAt', tx.created_at,
          'source', case
            when installment.payment_id is not null
              then 'installment_payment'
            when installment.payoff_id is not null
              then 'installment_payoff'
            else null
          end,
          'sourceId', coalesce(
            installment.payment_id,
            installment.payoff_id
          )
        )
      )
      order by tx.financial_date desc, tx.created_at desc, tx.id
    ),
    '[]'::jsonb
  )
  from public.transactions tx
  left join public.installment_transaction_links installment
    on installment.transaction_id = tx.id
  where p_workspace_id is not null
    and tx.workspace_id = p_workspace_id
    and tx.type in ('income', 'expense')
    and tx.state = 'posted'
$$;

create function public.snapshot_installment_contracts(p_workspace_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_strip_nulls(
        jsonb_build_object(
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
          'annualRate', trim(
            trailing '.' from trim(
              trailing '0' from contract.annual_rate::text
            )
          ),
          'periods', contract.periods,
          'firstDueDate', contract.first_due_date,
          'fundingAccountId', contract.funding_account_id,
          'expenseCategoryId', contract.expense_category_id,
          'interestCategoryId', contract.interest_category_id,
          'status', contract.status,
          'version', contract.version
        )
      )
      order by contract.created_at, contract.id
    ),
    '[]'::jsonb
  )
  from public.installment_contracts contract
  where p_workspace_id is not null
    and contract.workspace_id = p_workspace_id
$$;

create function public.snapshot_installment_schedules(p_workspace_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_object_agg(
      schedule.contract_id::text,
      schedule.rows
      order by schedule.contract_id
    ),
    '{}'::jsonb
  )
  from (
    select
      row.contract_id,
      jsonb_agg(
        jsonb_build_object(
          'sequence', row.sequence,
          'dueDate', row.due_date,
          'openingPrincipal', public.format_money(
            row.opening_principal,
            contract.currency
          ),
          'principal', public.format_money(
            row.scheduled_principal,
            contract.currency
          ),
          'interest', public.format_money(
            row.scheduled_interest,
            contract.currency
          ),
          'fees', public.format_money(
            row.scheduled_fees,
            contract.currency
          ),
          'total', public.format_money(
            row.scheduled_principal
              + row.scheduled_interest
              + row.scheduled_fees,
            contract.currency
          ),
          'closingPrincipal', public.format_money(
            row.closing_principal,
            contract.currency
          ),
          'paidPrincipal', public.format_money(
            row.paid_principal,
            contract.currency
          ),
          'paidInterest', public.format_money(
            row.paid_interest,
            contract.currency
          ),
          'paidFees', public.format_money(
            row.paid_fees,
            contract.currency
          ),
          'paidPenalty', public.format_money(
            row.paid_penalty,
            contract.currency
          ),
          'scheduledPenalty', public.format_money(
            row.scheduled_penalty,
            contract.currency
          ),
          'status', row.status
        )
        order by row.sequence, row.id
      ) as rows
    from public.installment_schedule_rows row
    join public.installment_contracts contract
      on contract.id = row.contract_id
    where p_workspace_id is not null
      and row.workspace_id = p_workspace_id
    group by row.contract_id
  ) schedule
$$;

create function public.snapshot_installment_payments(p_workspace_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_strip_nulls(
        jsonb_build_object(
          'id', payment.id,
          'workspaceId', payment.workspace_id,
          'contractId', payment.contract_id,
          'sequence', row.sequence,
          'accountId', payment.account_id,
          'amount', public.format_money(
            payment.amount,
            payment.currency
          ),
          'currency', payment.currency,
          'financialDate', payment.financial_date,
          'penaltyAssessed', public.format_money(
            coalesce(
              (payment.request_json ->> 'penaltyAmount')::numeric,
              payment.allocated_penalty
            ),
            payment.currency
          ),
          'allocatedPenalty', public.format_money(
            payment.allocated_penalty,
            payment.currency
          ),
          'allocatedFees', public.format_money(
            payment.allocated_fees,
            payment.currency
          ),
          'allocatedInterest', public.format_money(
            payment.allocated_interest,
            payment.currency
          ),
          'allocatedPrincipal', public.format_money(
            payment.allocated_principal,
            payment.currency
          ),
          'reportableExpense', public.format_money(
            payment.allocated_penalty
              + payment.allocated_fees
              + payment.allocated_interest,
            payment.currency
          ),
          'expenseTransactionId', (
            select link.transaction_id
            from public.installment_transaction_links link
            where link.payment_id = payment.id
            order by link.transaction_id
            limit 1
          ),
          'note', payment.note,
          'clientMutationId', payment.client_mutation_id,
          'createdAt', payment.created_at
        )
      )
      order by payment.financial_date desc, payment.created_at desc, payment.id
    ),
    '[]'::jsonb
  )
  from public.installment_payments payment
  join public.installment_schedule_rows row
    on row.id = payment.schedule_row_id
  where p_workspace_id is not null
    and payment.workspace_id = p_workspace_id
$$;

create function public.snapshot_installment_payoffs(p_workspace_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_strip_nulls(
        jsonb_build_object(
          'id', payoff.id,
          'workspaceId', payoff.workspace_id,
          'contractId', payoff.contract_id,
          'accountId', payoff.account_id,
          'action', payoff.action,
          'strategy', payoff.strategy,
          'expectedRemainingPrincipal',
            payoff.request_json ->> 'expectedRemainingPrincipal',
          'extraPrincipal', payoff.request_json ->> 'extraPrincipal',
          'quotedInterest', payoff.request_json ->> 'quotedInterest',
          'quotedFees', payoff.request_json ->> 'quotedFees',
          'principalPayment', public.format_money(
            payoff.principal_payment,
            payoff.currency
          ),
          'interestDue', public.format_money(
            payoff.interest_due,
            payoff.currency
          ),
          'feesDue', public.format_money(
            payoff.fees_due,
            payoff.currency
          ),
          'totalCashRequired', public.format_money(
            payoff.total_cash_required,
            payoff.currency
          ),
          'remainingPrincipal', public.format_money(
            payoff.remaining_principal,
            payoff.currency
          ),
          'interestSaved', public.format_money(
            payoff.interest_saved,
            payoff.currency
          ),
          'currency', payoff.currency,
          'financialDate', payoff.financial_date,
          'priorRows', (
            select coalesce(
              jsonb_agg(
                jsonb_build_object(
                  'sequence', (prior ->> 'sequence')::integer,
                  'dueDate', prior ->> 'due_date',
                  'openingPrincipal', public.format_money(
                    (prior ->> 'opening_principal')::numeric,
                    payoff.currency
                  ),
                  'principal', public.format_money(
                    (prior ->> 'scheduled_principal')::numeric,
                    payoff.currency
                  ),
                  'interest', public.format_money(
                    (prior ->> 'scheduled_interest')::numeric,
                    payoff.currency
                  ),
                  'fees', public.format_money(
                    (prior ->> 'scheduled_fees')::numeric,
                    payoff.currency
                  ),
                  'total', public.format_money(
                    (prior ->> 'scheduled_principal')::numeric
                      + (prior ->> 'scheduled_interest')::numeric
                      + (prior ->> 'scheduled_fees')::numeric,
                    payoff.currency
                  ),
                  'closingPrincipal', public.format_money(
                    (prior ->> 'closing_principal')::numeric,
                    payoff.currency
                  ),
                  'paidPrincipal', public.format_money(
                    (prior ->> 'paid_principal')::numeric,
                    payoff.currency
                  ),
                  'paidInterest', public.format_money(
                    (prior ->> 'paid_interest')::numeric,
                    payoff.currency
                  ),
                  'paidFees', public.format_money(
                    (prior ->> 'paid_fees')::numeric,
                    payoff.currency
                  ),
                  'paidPenalty', public.format_money(
                    (prior ->> 'paid_penalty')::numeric,
                    payoff.currency
                  ),
                  'scheduledPenalty', public.format_money(
                    (prior ->> 'scheduled_penalty')::numeric,
                    payoff.currency
                  ),
                  'status', prior ->> 'status'
                )
                order by (prior ->> 'sequence')::integer
              ),
              '[]'::jsonb
            )
            from jsonb_array_elements(payoff.prior_schedule) prior
          ),
          'regeneratedRows', (
            select coalesce(
              jsonb_agg(
                jsonb_build_object(
                  'sequence', (regenerated ->> 'sequence')::integer,
                  'dueDate', regenerated ->> 'dueDate',
                  'openingPrincipal', regenerated ->> 'openingPrincipal',
                  'principal', regenerated ->> 'principal',
                  'interest', regenerated ->> 'interest',
                  'fees', regenerated ->> 'fees',
                  'total', regenerated ->> 'total',
                  'closingPrincipal', regenerated ->> 'closingPrincipal',
                  'paidPrincipal', public.format_money(0, payoff.currency),
                  'paidInterest', public.format_money(0, payoff.currency),
                  'paidFees', public.format_money(0, payoff.currency),
                  'paidPenalty', public.format_money(0, payoff.currency),
                  'scheduledPenalty', public.format_money(0, payoff.currency),
                  'status', 'upcoming'
                )
                order by (regenerated ->> 'sequence')::integer
              ),
              '[]'::jsonb
            )
            from jsonb_array_elements(
              coalesce(
                payoff.request_json -> 'regeneratedRows',
                '[]'::jsonb
              )
            ) regenerated
          ),
          'expenseTransactionId', (
            select link.transaction_id
            from public.installment_transaction_links link
            where link.payoff_id = payoff.id
            order by link.transaction_id
            limit 1
          ),
          'note', payoff.note,
          'clientMutationId', payoff.client_mutation_id,
          'createdAt', payoff.created_at
        )
      )
      order by payoff.financial_date desc, payoff.created_at desc, payoff.id
    ),
    '[]'::jsonb
  )
  from public.installment_payoffs payoff
  where p_workspace_id is not null
    and payoff.workspace_id = p_workspace_id
$$;

create function public.get_finance_snapshot()
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
      public.snapshot_installment_payoffs(workspace.id)
  )
  from (select true) singleton
  left join selected_workspace workspace on true
$$;

revoke all on function public.snapshot_categories(uuid) from public;
revoke all on function public.snapshot_accounts(uuid) from public;
revoke all on function public.snapshot_account_balances(uuid) from public;
revoke all on function public.snapshot_opening_transactions(uuid) from public;
revoke all on function public.snapshot_transactions(uuid) from public;
revoke all on function public.snapshot_installment_contracts(uuid) from public;
revoke all on function public.snapshot_installment_schedules(uuid) from public;
revoke all on function public.snapshot_installment_payments(uuid) from public;
revoke all on function public.snapshot_installment_payoffs(uuid) from public;
revoke all on function public.get_finance_snapshot() from public;

grant execute on function public.snapshot_categories(uuid)
  to authenticated;
grant execute on function public.snapshot_accounts(uuid)
  to authenticated;
grant execute on function public.snapshot_account_balances(uuid)
  to authenticated;
grant execute on function public.snapshot_opening_transactions(uuid)
  to authenticated;
grant execute on function public.snapshot_transactions(uuid)
  to authenticated;
grant execute on function public.snapshot_installment_contracts(uuid)
  to authenticated;
grant execute on function public.snapshot_installment_schedules(uuid)
  to authenticated;
grant execute on function public.snapshot_installment_payments(uuid)
  to authenticated;
grant execute on function public.snapshot_installment_payoffs(uuid)
  to authenticated;
grant execute on function public.get_finance_snapshot()
  to authenticated;
grant execute on function public.format_money(numeric, text)
  to authenticated;
