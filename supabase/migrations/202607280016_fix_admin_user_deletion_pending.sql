create or replace function public.list_admin_users(
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
      coalesce(
        (
          auth_user.raw_app_meta_data
            ->> 'baan_ngern_dee_deletion_pending'
        ) = 'true',
        false
      ) as deletion_pending,
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

revoke all on function public.list_admin_users(
  text,
  integer,
  timestamptz,
  uuid
) from public, anon, authenticated;

grant execute on function public.list_admin_users(
  text,
  integer,
  timestamptz,
  uuid
) to service_role;
