create type public.workspace_kind as enum ('private', 'family');
create type public.workspace_role as enum ('owner', 'editor', 'viewer');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0)
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  kind public.workspace_kind not null,
  base_currency text not null
    check (base_currency ~ '^[A-Z]{3}$'),
  timezone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  version integer not null default 1 check (version > 0)
);

create unique index one_active_private_workspace_per_owner
  on public.workspaces (owner_user_id)
  where kind = 'private' and archived_at is null;

create table public.workspace_members (
  workspace_id uuid not null
    references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.workspace_role not null,
  joined_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  primary key (workspace_id, user_id)
);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

revoke all on function public.handle_new_user() from public;

create function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.workspace_members member
      where member.workspace_id = p_workspace_id
        and member.user_id = auth.uid()
    )
$$;

create function public.workspace_role_for(p_workspace_id uuid)
returns public.workspace_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select member.role
  from public.workspace_members member
  where member.workspace_id = p_workspace_id
    and member.user_id = auth.uid()
$$;

revoke all on function public.is_workspace_member(uuid) from public;
revoke all on function public.workspace_role_for(uuid) from public;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

create policy profile_select_self
on public.profiles for select
using (id = auth.uid());

create policy profile_update_self
on public.profiles for update
using (id = auth.uid())
with check (id = auth.uid());

create policy workspace_select_member
on public.workspaces for select
using (public.is_workspace_member(id));

create policy workspace_update_owner
on public.workspaces for update
using (public.workspace_role_for(id) = 'owner')
with check (
  public.workspace_role_for(id) = 'owner'
  and owner_user_id = auth.uid()
);

create policy workspace_member_select_member
on public.workspace_members for select
using (public.is_workspace_member(workspace_id));

grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, update on public.workspaces to authenticated;
grant select on public.workspace_members to authenticated;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.workspace_role_for(uuid) to authenticated;
