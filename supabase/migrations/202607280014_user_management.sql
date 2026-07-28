create table public.user_admin_audit (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null,
  target_user_id uuid not null,
  action text not null check (
    action in (
      'confirmed',
      'suspended',
      'resumed',
      'password_reset_requested',
      'deletion_requested'
    )
  ),
  client_mutation_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  purge_completed_at timestamptz,
  completed_at timestamptz
);

create unique index user_admin_audit_destructive_mutation
  on public.user_admin_audit (client_mutation_id)
  where client_mutation_id is not null;

create index user_admin_audit_target_action_created
  on public.user_admin_audit (
    target_user_id,
    action,
    created_at desc
  );

alter table public.user_admin_audit enable row level security;
revoke all on table public.user_admin_audit
  from public, anon, authenticated;
grant select, insert, update on table public.user_admin_audit
  to service_role;

create function public.list_admin_users(
  p_search_text text,
  p_page_limit integer,
  p_cursor_created_at timestamptz,
  p_cursor_user_id uuid
)
returns table (
  user_id uuid,
  email text,
  display_name text,
  status text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz,
  banned_until timestamptz,
  private_workspace_count integer,
  deletion_pending boolean
)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  with sanitized as (
    select
      auth_user.id as user_id,
      lower(auth_user.email) as email,
      left(
        coalesce(
          nullif(btrim(profile.display_name), ''),
          nullif(
            btrim(
              auth_user.raw_user_meta_data ->> 'display_name'
            ),
            ''
          ),
          split_part(lower(auth_user.email), '@', 1)
        ),
        80
      ) as display_name,
      auth_user.created_at,
      auth_user.last_sign_in_at,
      auth_user.email_confirmed_at,
      auth_user.banned_until,
      (
        auth_user.raw_app_meta_data
          ->> 'baan_ngern_dee_deletion_pending'
      ) = 'true' as deletion_pending,
      (
        select count(*)::integer
        from public.workspaces workspace
        where workspace.owner_user_id = auth_user.id
          and workspace.kind = 'private'
      ) as private_workspace_count
    from auth.users auth_user
    left join public.profiles profile
      on profile.id = auth_user.id
    where auth_user.email is not null
  )
  select
    sanitized.user_id,
    sanitized.email,
    sanitized.display_name,
    case
      when sanitized.deletion_pending then 'deletion_pending'
      when sanitized.banned_until > now() then 'suspended'
      when sanitized.email_confirmed_at is null then 'unconfirmed'
      else 'active'
    end as status,
    sanitized.created_at,
    sanitized.last_sign_in_at,
    sanitized.email_confirmed_at,
    sanitized.banned_until,
    sanitized.private_workspace_count,
    sanitized.deletion_pending
  from sanitized
  where (
      coalesce(btrim(p_search_text), '') = ''
      or sanitized.email ilike
        '%' || btrim(p_search_text) || '%'
      or sanitized.display_name ilike
        '%' || btrim(p_search_text) || '%'
    )
    and (
      p_cursor_created_at is null
      or p_cursor_user_id is null
      or (sanitized.created_at, sanitized.user_id)
        < (p_cursor_created_at, p_cursor_user_id)
    )
  order by sanitized.created_at desc, sanitized.user_id desc
  limit least(greatest(coalesce(p_page_limit, 25), 1), 51)
$$;

create function public.record_user_admin_action(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_action text,
  p_details jsonb
)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if p_action not in (
    'confirmed',
    'suspended',
    'resumed',
    'password_reset_requested'
  ) then
    raise exception using
      errcode = '22023',
      message = 'USER_ADMIN_ACTION_FAILED';
  end if;

  if p_action = 'password_reset_requested' then
    perform pg_advisory_xact_lock(
      hashtextextended(
        p_actor_user_id::text || ':' || p_target_user_id::text,
        0
      )
    );
    if exists (
      select 1
      from public.user_admin_audit audit
      where audit.actor_user_id = p_actor_user_id
        and audit.target_user_id = p_target_user_id
        and audit.action = 'password_reset_requested'
        and audit.created_at > now() - interval '60 seconds'
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'USER_ADMIN_RATE_LIMITED';
    end if;
  end if;

  insert into public.user_admin_audit (
    actor_user_id,
    target_user_id,
    action,
    details,
    completed_at
  )
  values (
    p_actor_user_id,
    p_target_user_id,
    p_action,
    coalesce(p_details, '{}'::jsonb),
    now()
  );
end;
$$;

create function public.get_user_deletion_state(
  p_target_user_id uuid,
  p_client_mutation_id uuid
)
returns table (
  purge_completed boolean,
  completed boolean
)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select
    audit.purge_completed_at is not null,
    audit.completed_at is not null
  from public.user_admin_audit audit
  where audit.target_user_id = p_target_user_id
    and audit.client_mutation_id = p_client_mutation_id
    and audit.action = 'deletion_requested'
$$;

create function public.purge_private_user_data(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_client_mutation_id uuid,
  p_normalized_email text
)
returns table (
  private_workspaces_deleted integer
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_existing public.user_admin_audit;
  v_private_workspaces integer;
  v_email text := lower(btrim(p_normalized_email));
begin
  if v_email = '' then
    raise exception using
      errcode = '22023',
      message = 'USER_ADMIN_ACTION_FAILED';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_target_user_id::text, 0)
  );

  select audit.*
  into v_existing
  from public.user_admin_audit audit
  where audit.client_mutation_id = p_client_mutation_id;

  if v_existing.id is not null then
    if v_existing.target_user_id <> p_target_user_id
      or v_existing.action <> 'deletion_requested'
      or v_existing.details ->> 'email' <> v_email
    then
      raise exception using
        errcode = 'P0001',
        message = 'USER_ADMIN_ACTION_FAILED';
    end if;

    if v_existing.purge_completed_at is not null then
      private_workspaces_deleted :=
        coalesce(
          (
            v_existing.details
              ->> 'privateWorkspacesDeleted'
          )::integer,
          0
        );
      return next;
      return;
    end if;
  end if;

  if exists (
    select 1
    from public.workspaces workspace
    where workspace.owner_user_id = p_target_user_id
      and workspace.kind <> 'private'
  ) or exists (
    select 1
    from public.workspace_members member
    join public.workspaces workspace
      on workspace.id = member.workspace_id
    where member.user_id = p_target_user_id
      and workspace.kind <> 'private'
  ) or exists (
    select 1
    from public.categories authored
    join public.workspaces workspace
      on workspace.id = authored.workspace_id
    where authored.created_by = p_target_user_id
      and (
        workspace.kind <> 'private'
        or workspace.owner_user_id <> p_target_user_id
      )
  ) or exists (
    select 1
    from public.tags authored
    join public.workspaces workspace
      on workspace.id = authored.workspace_id
    where authored.created_by = p_target_user_id
      and (
        workspace.kind <> 'private'
        or workspace.owner_user_id <> p_target_user_id
      )
  ) or exists (
    select 1
    from public.merchants authored
    join public.workspaces workspace
      on workspace.id = authored.workspace_id
    where authored.created_by = p_target_user_id
      and (
        workspace.kind <> 'private'
        or workspace.owner_user_id <> p_target_user_id
      )
  ) or exists (
    select 1
    from public.audit_events authored
    join public.workspaces workspace
      on workspace.id = authored.workspace_id
    where authored.actor_user_id = p_target_user_id
      and (
        workspace.kind <> 'private'
        or workspace.owner_user_id <> p_target_user_id
      )
  ) or exists (
    select 1
    from public.accounts authored
    join public.workspaces workspace
      on workspace.id = authored.workspace_id
    where authored.created_by = p_target_user_id
      and (
        workspace.kind <> 'private'
        or workspace.owner_user_id <> p_target_user_id
      )
  ) or exists (
    select 1
    from public.transactions authored
    join public.workspaces workspace
      on workspace.id = authored.workspace_id
    where (
        authored.created_by = p_target_user_id
        or authored.voided_by = p_target_user_id
      )
      and (
        workspace.kind <> 'private'
        or workspace.owner_user_id <> p_target_user_id
      )
  ) or exists (
    select 1
    from public.transfers authored
    join public.workspaces workspace
      on workspace.id = authored.workspace_id
    where authored.created_by = p_target_user_id
      and (
        workspace.kind <> 'private'
        or workspace.owner_user_id <> p_target_user_id
      )
  ) or exists (
    select 1
    from public.installment_contracts authored
    join public.workspaces workspace
      on workspace.id = authored.workspace_id
    where authored.created_by = p_target_user_id
      and (
        workspace.kind <> 'private'
        or workspace.owner_user_id <> p_target_user_id
      )
  ) or exists (
    select 1
    from public.installment_payments authored
    join public.workspaces workspace
      on workspace.id = authored.workspace_id
    where authored.created_by = p_target_user_id
      and (
        workspace.kind <> 'private'
        or workspace.owner_user_id <> p_target_user_id
      )
  ) or exists (
    select 1
    from public.installment_payoffs authored
    join public.workspaces workspace
      on workspace.id = authored.workspace_id
    where authored.created_by = p_target_user_id
      and (
        workspace.kind <> 'private'
        or workspace.owner_user_id <> p_target_user_id
      )
  ) or exists (
    select 1
    from public.recurring_templates authored
    join public.workspaces workspace
      on workspace.id = authored.workspace_id
    where authored.created_by = p_target_user_id
      and (
        workspace.kind <> 'private'
        or workspace.owner_user_id <> p_target_user_id
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'USER_SHARED_DATA_CONFLICT';
  end if;

  select count(*)::integer
  into v_private_workspaces
  from public.workspaces workspace
  where workspace.owner_user_id = p_target_user_id
    and workspace.kind = 'private';

  if v_existing.id is null then
    insert into public.user_admin_audit (
      actor_user_id,
      target_user_id,
      action,
      client_mutation_id,
      details
    )
    values (
      p_actor_user_id,
      p_target_user_id,
      'deletion_requested',
      p_client_mutation_id,
      jsonb_build_object('email', v_email)
    )
    returning * into v_existing;
  end if;

  delete from public.workspaces
  where owner_user_id = p_target_user_id
    and kind = 'private';

  delete from public.workspace_members
  where user_id = p_target_user_id;

  delete from public.profiles
  where id = p_target_user_id;

  update public.user_admin_audit audit
  set
    purge_completed_at = now(),
    details = audit.details || jsonb_build_object(
      'privateWorkspacesDeleted',
      v_private_workspaces
    )
  where audit.id = v_existing.id;

  private_workspaces_deleted := v_private_workspaces;
  return next;
end;
$$;

create function public.complete_user_deletion(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_client_mutation_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_target_user_id::text, 0)
  );

  update public.user_admin_audit audit
  set completed_at = coalesce(audit.completed_at, now())
  where audit.actor_user_id = p_actor_user_id
    and audit.target_user_id = p_target_user_id
    and audit.client_mutation_id = p_client_mutation_id
    and audit.action = 'deletion_requested'
    and audit.purge_completed_at is not null;

  if not found then
    if not exists (
      select 1
      from public.user_admin_audit audit
      where audit.actor_user_id = p_actor_user_id
        and audit.target_user_id = p_target_user_id
        and audit.client_mutation_id = p_client_mutation_id
        and audit.action = 'deletion_requested'
        and audit.completed_at is not null
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'USER_ADMIN_ACTION_FAILED';
    end if;
  end if;
end;
$$;

alter table public.user_invitations
  drop constraint if exists
    user_invitations_redeemed_user_id_fkey;
alter table public.user_invitations
  add constraint user_invitations_redeemed_user_id_fkey
  foreign key (redeemed_user_id)
  references auth.users (id)
  on delete set null;

revoke all on function public.list_admin_users(
  text,
  integer,
  timestamptz,
  uuid
) from public, anon, authenticated;
revoke all on function public.record_user_admin_action(
  uuid,
  uuid,
  text,
  jsonb
) from public, anon, authenticated;
revoke all on function public.get_user_deletion_state(
  uuid,
  uuid
) from public, anon, authenticated;
revoke all on function public.purge_private_user_data(
  uuid,
  uuid,
  uuid,
  text
) from public, anon, authenticated;
revoke all on function public.complete_user_deletion(
  uuid,
  uuid,
  uuid
) from public, anon, authenticated;

grant execute on function public.list_admin_users(
  text,
  integer,
  timestamptz,
  uuid
) to service_role;
grant execute on function public.record_user_admin_action(
  uuid,
  uuid,
  text,
  jsonb
) to service_role;
grant execute on function public.get_user_deletion_state(
  uuid,
  uuid
) to service_role;
grant execute on function public.purge_private_user_data(
  uuid,
  uuid,
  uuid,
  text
) to service_role;
grant execute on function public.complete_user_deletion(
  uuid,
  uuid,
  uuid
) to service_role;
