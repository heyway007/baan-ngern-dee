create or replace function public.snapshot_transactions(
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
          'voidedAt', tx.voided_at,
          'voidReason', tx.void_reason,
          'source', case
            when transfer_link.transfer_id is not null
              then 'transfer_fee'
            when installment.payment_id is not null
              then 'installment_payment'
            when installment.payoff_id is not null
              then 'installment_payoff'
            when recurring.id is not null
              then 'recurring_occurrence'
            else null
          end,
          'sourceId', coalesce(
            transfer_link.transfer_id,
            installment.payment_id,
            installment.payoff_id,
            recurring.id
          )
        )
      )
      order by tx.financial_date desc, tx.created_at desc, tx.id
    ),
    '[]'::jsonb
  )
  from public.transactions tx
  left join public.transfer_links transfer_link
    on transfer_link.fee_transaction_id = tx.id
  left join public.installment_transaction_links installment
    on installment.transaction_id = tx.id
  left join public.recurring_occurrences recurring
    on recurring.transaction_id = tx.id
  where p_workspace_id is not null
    and tx.workspace_id = p_workspace_id
    and tx.type in ('income', 'expense')
    and tx.state in ('posted', 'void')
$$;
