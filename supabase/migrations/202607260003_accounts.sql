create type public.account_type as enum (
  'cash',
  'bank',
  'ewallet',
  'credit_card',
  'loan',
  'asset'
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.workspaces (id) on delete cascade,
  created_by uuid not null references auth.users (id),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  type public.account_type not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  institution text
    check (
      institution is null
      or char_length(btrim(institution)) between 1 and 120
    ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  version integer not null default 1 check (version > 0)
);

create unique index account_active_name
  on public.accounts (workspace_id, lower(name))
  where archived_at is null;

alter table public.accounts enable row level security;

create policy account_select_member
on public.accounts for select
using (public.is_workspace_member(workspace_id));

create policy account_insert_editor
on public.accounts for insert
with check (
  created_by = auth.uid()
  and public.workspace_role_for(workspace_id) in ('owner', 'editor')
);

create policy account_update_editor
on public.accounts for update
using (public.workspace_role_for(workspace_id) in ('owner', 'editor'))
with check (public.workspace_role_for(workspace_id) in ('owner', 'editor'));

create function public.create_account(
  p_workspace_id uuid,
  p_name text,
  p_type public.account_type,
  p_currency text,
  p_institution text default null
)
returns setof public.accounts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_account_id uuid;
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'authentication required';
  end if;

  if coalesce(
    public.workspace_role_for(p_workspace_id)::text,
    ''
  ) not in ('owner', 'editor') then
    raise exception using
      errcode = '42501',
      message = 'workspace access denied';
  end if;

  if char_length(btrim(p_name)) not between 1 and 80
    or p_currency !~ '^[A-Z]{3}$'
    or (
      p_institution is not null
      and char_length(btrim(p_institution)) not between 1 and 120
    )
  then
    raise exception using
      errcode = '22023',
      message = 'invalid account metadata';
  end if;

  insert into public.accounts (
    workspace_id,
    created_by,
    name,
    type,
    currency,
    institution
  )
  values (
    p_workspace_id,
    v_user_id,
    btrim(p_name),
    p_type,
    p_currency,
    nullif(btrim(p_institution), '')
  )
  returning id into v_account_id;

  insert into public.audit_events (
    workspace_id,
    actor_user_id,
    action,
    entity_type,
    entity_id
  )
  values (
    p_workspace_id,
    v_user_id,
    'account.created',
    'account',
    v_account_id
  );

  return query
  select account.*
  from public.accounts account
  where account.id = v_account_id;
end;
$$;

revoke all on function public.create_account(
  uuid,
  text,
  public.account_type,
  text,
  text
) from public;

grant execute on function public.create_account(
  uuid,
  text,
  public.account_type,
  text,
  text
) to authenticated;

grant select, insert, update on public.accounts to authenticated;
