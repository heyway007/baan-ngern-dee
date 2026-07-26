create type public.category_kind as enum ('income', 'expense');

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.workspaces (id) on delete cascade,
  parent_id uuid references public.categories (id),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  kind public.category_kind not null,
  is_default boolean not null default false,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  version integer not null default 1 check (version > 0),
  unique (workspace_id, slug)
);

create unique index category_active_sibling_name
  on public.categories (
    workspace_id,
    kind,
    lower(name),
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where archived_at is null;

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 50),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  version integer not null default 1 check (version > 0)
);

create unique index tag_active_name
  on public.tags (workspace_id, lower(name))
  where archived_at is null;

create table public.merchants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  version integer not null default 1 check (version > 0)
);

create unique index merchant_active_name
  on public.merchants (workspace_id, lower(name))
  where archived_at is null;

create table public.audit_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null
    references public.workspaces (id) on delete cascade,
  actor_user_id uuid not null references auth.users (id),
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  safe_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.categories enable row level security;
alter table public.tags enable row level security;
alter table public.merchants enable row level security;
alter table public.audit_events enable row level security;

create policy category_select_member
on public.categories for select
using (public.is_workspace_member(workspace_id));

create policy category_insert_editor
on public.categories for insert
with check (
  created_by = auth.uid()
  and public.workspace_role_for(workspace_id) in ('owner', 'editor')
);

create policy category_update_editor
on public.categories for update
using (public.workspace_role_for(workspace_id) in ('owner', 'editor'))
with check (public.workspace_role_for(workspace_id) in ('owner', 'editor'));

create policy tag_select_member
on public.tags for select
using (public.is_workspace_member(workspace_id));

create policy tag_write_editor
on public.tags for all
using (public.workspace_role_for(workspace_id) in ('owner', 'editor'))
with check (
  created_by = auth.uid()
  and public.workspace_role_for(workspace_id) in ('owner', 'editor')
);

create policy merchant_select_member
on public.merchants for select
using (public.is_workspace_member(workspace_id));

create policy merchant_write_editor
on public.merchants for all
using (public.workspace_role_for(workspace_id) in ('owner', 'editor'))
with check (
  created_by = auth.uid()
  and public.workspace_role_for(workspace_id) in ('owner', 'editor')
);

create policy audit_select_member
on public.audit_events for select
using (public.is_workspace_member(workspace_id));

create function public.create_private_workspace(
  p_name text,
  p_base_currency text default 'THB',
  p_timezone text default 'Asia/Bangkok'
)
returns setof public.workspaces
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'authentication required';
  end if;

  if char_length(btrim(p_name)) not between 1 and 80 then
    raise exception using
      errcode = '22023',
      message = 'invalid workspace name';
  end if;

  if p_base_currency !~ '^[A-Z]{3}$' then
    raise exception using
      errcode = '22023',
      message = 'invalid base currency';
  end if;

  begin
    perform now() at time zone p_timezone;
  exception
    when invalid_parameter_value then
      raise exception using
        errcode = '22023',
        message = 'invalid IANA timezone';
  end;

  if exists (
    select 1
    from public.workspaces
    where owner_user_id = v_user_id
      and kind = 'private'
      and archived_at is null
  ) then
    raise exception using
      errcode = '23505',
      message = 'active private workspace already exists';
  end if;

  insert into public.workspaces (
    owner_user_id,
    name,
    kind,
    base_currency,
    timezone
  )
  values (
    v_user_id,
    btrim(p_name),
    'private',
    p_base_currency,
    p_timezone
  )
  returning id into v_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace_id, v_user_id, 'owner');

  insert into public.categories (
    workspace_id,
    slug,
    name,
    kind,
    is_default,
    created_by
  )
  values
    (v_workspace_id, 'salary', 'เงินเดือน', 'income', true, v_user_id),
    (v_workspace_id, 'bonus', 'โบนัส', 'income', true, v_user_id),
    (v_workspace_id, 'freelance', 'งานเสริม', 'income', true, v_user_id),
    (v_workspace_id, 'interest-income', 'ดอกเบี้ยรับ', 'income', true, v_user_id),
    (v_workspace_id, 'gift-income', 'ของขวัญ', 'income', true, v_user_id),
    (v_workspace_id, 'other-income', 'รายรับอื่น', 'income', true, v_user_id),
    (v_workspace_id, 'food', 'อาหาร', 'expense', true, v_user_id),
    (v_workspace_id, 'groceries', 'ของใช้ในบ้าน', 'expense', true, v_user_id),
    (v_workspace_id, 'housing', 'ที่อยู่อาศัย', 'expense', true, v_user_id),
    (v_workspace_id, 'utilities', 'สาธารณูปโภค', 'expense', true, v_user_id),
    (v_workspace_id, 'transport', 'เดินทาง', 'expense', true, v_user_id),
    (v_workspace_id, 'health', 'สุขภาพ', 'expense', true, v_user_id),
    (v_workspace_id, 'education', 'การศึกษา', 'expense', true, v_user_id),
    (v_workspace_id, 'shopping', 'ช้อปปิ้ง', 'expense', true, v_user_id),
    (v_workspace_id, 'entertainment', 'บันเทิง', 'expense', true, v_user_id),
    (v_workspace_id, 'debt-interest', 'ดอกเบี้ยหนี้', 'expense', true, v_user_id),
    (v_workspace_id, 'financial-fees', 'ค่าธรรมเนียม', 'expense', true, v_user_id),
    (v_workspace_id, 'other-expense', 'รายจ่ายอื่น', 'expense', true, v_user_id);

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
    'workspace.created',
    'workspace',
    v_workspace_id
  );

  return query
  select workspace.*
  from public.workspaces workspace
  where workspace.id = v_workspace_id;
end;
$$;

revoke all on function public.create_private_workspace(text, text, text)
  from public;
grant execute on function public.create_private_workspace(text, text, text)
  to authenticated;

grant select, insert, update on public.categories to authenticated;
grant select, insert, update on public.tags to authenticated;
grant select, insert, update on public.merchants to authenticated;
grant select on public.audit_events to authenticated;
