create table public.user_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check (
    email = lower(btrim(email))
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  display_name text not null check (
    char_length(btrim(display_name)) between 1 and 80
  ),
  token_hash text not null unique check (
    token_hash ~ '^[0-9a-f]{64}$'
  ),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'pending' check (
    status in ('pending', 'claimed', 'redeemed', 'revoked')
  ),
  claim_id uuid,
  claimed_at timestamptz,
  redeemed_claim_id uuid,
  redeemed_at timestamptz,
  redeemed_user_id uuid references auth.users (id),
  revoked_at timestamptz,
  check (expires_at > created_at),
  check ((status = 'claimed') = (claim_id is not null)),
  check ((status = 'redeemed') = (redeemed_claim_id is not null)),
  check ((status = 'redeemed') = (redeemed_at is not null)),
  check ((status = 'revoked') = (revoked_at is not null))
);

create unique index user_invitations_one_live_email
  on public.user_invitations (email)
  where status in ('pending', 'claimed');

create table public.user_invitation_audit (
  id bigint generated always as identity primary key,
  invitation_id uuid references public.user_invitations (id)
    on delete set null,
  actor_user_id uuid references auth.users (id)
    on delete set null,
  event_name text not null check (
    event_name in (
      'created',
      'replaced',
      'revoked',
      'claimed',
      'released',
      'redeemed'
    )
  ),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.user_invitations enable row level security;
alter table public.user_invitation_audit enable row level security;

revoke all on public.user_invitations
  from public, anon, authenticated;
revoke all on public.user_invitation_audit
  from public, anon, authenticated;
grant all on public.user_invitations to service_role;
grant all on public.user_invitation_audit to service_role;
grant usage, select on sequence public.user_invitation_audit_id_seq
  to service_role;

create function public.invitation_auth_user_exists(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
    from auth.users
    where lower(email) = lower(btrim(p_email))
  )
$$;

create function public.create_user_invitation(
  p_email text,
  p_display_name text,
  p_token_hash text,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_email text := lower(btrim(p_email));
  v_display_name text := btrim(p_display_name);
  v_invitation public.user_invitations;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_created_by::text, 0)
  );

  if public.invitation_auth_user_exists(v_email) then
    raise exception using
      errcode = 'P0001',
      message = 'EMAIL_ALREADY_REGISTERED';
  end if;

  if (
    select count(*)
    from public.user_invitation_audit
    where actor_user_id = p_created_by
      and event_name in ('created', 'replaced')
      and created_at > now() - interval '1 hour'
  ) >= 20 then
    raise exception using
      errcode = 'P0001',
      message = 'INVITATION_CREATE_FAILED';
  end if;

  begin
    insert into public.user_invitations (
      email,
      display_name,
      token_hash,
      created_by,
      expires_at
    )
    values (
      v_email,
      v_display_name,
      p_token_hash,
      p_created_by,
      now() + interval '24 hours'
    )
    returning * into v_invitation;
  exception
    when unique_violation then
      raise exception using
        errcode = 'P0001',
        message = 'ACTIVE_INVITATION_EXISTS';
  end;

  insert into public.user_invitation_audit (
    invitation_id,
    actor_user_id,
    event_name
  )
  values (v_invitation.id, p_created_by, 'created');

  return jsonb_build_object(
    'id', v_invitation.id,
    'email', v_invitation.email,
    'displayName', v_invitation.display_name,
    'status', v_invitation.status,
    'createdAt', v_invitation.created_at,
    'expiresAt', v_invitation.expires_at
  );
end;
$$;

create function public.list_user_invitations()
returns jsonb
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_strip_nulls(
        jsonb_build_object(
          'id', invitation.id,
          'email', invitation.email,
          'displayName', invitation.display_name,
          'status',
            case
              when invitation.status in ('pending', 'claimed')
                and invitation.expires_at <= now() then 'expired'
              when invitation.status = 'claimed'
                and invitation.claimed_at <
                  now() - interval '5 minutes' then 'ready'
              when invitation.status = 'pending' then 'ready'
              when invitation.status = 'claimed' then 'busy'
              else invitation.status
            end,
          'createdAt', invitation.created_at,
          'expiresAt', invitation.expires_at,
          'redeemedAt', invitation.redeemed_at,
          'revokedAt', invitation.revoked_at
        )
      )
      order by invitation.created_at desc
    ),
    '[]'::jsonb
  )
  from public.user_invitations invitation
$$;

create function public.inspect_user_invitation(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_invitation public.user_invitations;
begin
  select *
  into v_invitation
  from public.user_invitations
  where token_hash = p_token_hash;

  if not found or v_invitation.status = 'revoked' then
    raise exception using
      errcode = 'P0001',
      message = 'INVITATION_INVALID';
  end if;
  if v_invitation.status = 'redeemed' then
    raise exception using
      errcode = 'P0001',
      message = 'INVITATION_REDEEMED';
  end if;
  if v_invitation.expires_at <= now() then
    raise exception using
      errcode = 'P0001',
      message = 'INVITATION_EXPIRED';
  end if;
  if v_invitation.status = 'claimed'
    and v_invitation.claimed_at >= now() - interval '5 minutes'
  then
    raise exception using
      errcode = 'P0001',
      message = 'INVITATION_BUSY';
  end if;
  if public.invitation_auth_user_exists(v_invitation.email) then
    raise exception using
      errcode = 'P0001',
      message = 'INVITATION_INVALID';
  end if;

  return jsonb_build_object(
    'displayName', v_invitation.display_name,
    'email', v_invitation.email
  );
end;
$$;

create function public.reconcile_user_invitation(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_invitation public.user_invitations;
  v_user auth.users;
  v_expected_claim_id uuid;
begin
  select *
  into v_invitation
  from public.user_invitations
  where token_hash = p_token_hash
  for update;

  if not found or v_invitation.status = 'revoked' then
    raise exception using
      errcode = 'P0001',
      message = 'INVITATION_INVALID';
  end if;

  v_expected_claim_id := case
    when v_invitation.status = 'redeemed'
      then v_invitation.redeemed_claim_id
    else v_invitation.claim_id
  end;

  if v_expected_claim_id is not null then
    select auth_user.*
    into v_user
    from auth.users auth_user
    where lower(auth_user.email) = v_invitation.email
      and auth_user.raw_app_meta_data
        ->> 'baan_ngern_dee_invitation_id'
          = v_invitation.id::text
      and auth_user.raw_app_meta_data
        ->> 'baan_ngern_dee_invitation_claim_id'
          = v_expected_claim_id::text
    limit 1;
  end if;

  if v_user.id is not null then
    if v_invitation.status = 'claimed' then
      update public.user_invitations
      set
        status = 'redeemed',
        redeemed_claim_id = claim_id,
        claim_id = null,
        redeemed_at = now(),
        redeemed_user_id = v_user.id
      where id = v_invitation.id;

      insert into public.user_invitation_audit (
        invitation_id,
        event_name,
        metadata
      )
      values (
        v_invitation.id,
        'redeemed',
        jsonb_build_object('reconciled', true)
      );
    end if;

    return jsonb_build_object(
      'email', v_invitation.email,
      'displayName', v_invitation.display_name
    );
  end if;

  if v_invitation.status = 'redeemed' then
    raise exception using
      errcode = 'P0001',
      message = 'INVITATION_REDEEMED';
  end if;
  if v_invitation.expires_at <= now() then
    raise exception using
      errcode = 'P0001',
      message = 'INVITATION_EXPIRED';
  end if;

  return null;
end;
$$;

create function public.claim_user_invitation(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_invitation public.user_invitations;
  v_claim_id uuid := gen_random_uuid();
begin
  select *
  into v_invitation
  from public.user_invitations
  where token_hash = p_token_hash
  for update;

  if not found or v_invitation.status = 'revoked' then
    raise exception using
      errcode = 'P0001',
      message = 'INVITATION_INVALID';
  end if;
  if v_invitation.status = 'redeemed' then
    raise exception using
      errcode = 'P0001',
      message = 'INVITATION_REDEEMED';
  end if;
  if v_invitation.expires_at <= now() then
    raise exception using
      errcode = 'P0001',
      message = 'INVITATION_EXPIRED';
  end if;
  if v_invitation.status = 'claimed'
    and v_invitation.claimed_at >= now() - interval '5 minutes'
  then
    raise exception using
      errcode = 'P0001',
      message = 'INVITATION_BUSY';
  end if;
  if public.invitation_auth_user_exists(v_invitation.email) then
    raise exception using
      errcode = 'P0001',
      message = 'EMAIL_ALREADY_REGISTERED';
  end if;

  update public.user_invitations
  set
    status = 'claimed',
    claim_id = v_claim_id,
    claimed_at = now()
  where id = v_invitation.id;

  insert into public.user_invitation_audit (
    invitation_id,
    event_name
  )
  values (v_invitation.id, 'claimed');

  return jsonb_build_object(
    'id', v_invitation.id,
    'email', v_invitation.email,
    'displayName', v_invitation.display_name,
    'claimId', v_claim_id
  );
end;
$$;

create function public.complete_user_invitation(
  p_id uuid,
  p_claim_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  update public.user_invitations
  set
    status = 'redeemed',
    redeemed_claim_id = claim_id,
    claim_id = null,
    redeemed_at = now(),
    redeemed_user_id = p_user_id
  where id = p_id
    and status = 'claimed'
    and claim_id = p_claim_id
    and exists (
      select 1
      from auth.users auth_user
      where auth_user.id = p_user_id
        and lower(auth_user.email) =
          public.user_invitations.email
        and auth_user.raw_app_meta_data
          ->> 'baan_ngern_dee_invitation_id' = p_id::text
        and auth_user.raw_app_meta_data
          ->> 'baan_ngern_dee_invitation_claim_id'
            = p_claim_id::text
    );

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'INVITATION_BUSY';
  end if;

  insert into public.user_invitation_audit (
    invitation_id,
    event_name
  )
  values (p_id, 'redeemed');
end;
$$;

create function public.release_user_invitation(
  p_id uuid,
  p_claim_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  update public.user_invitations
  set
    status = 'pending',
    claim_id = null,
    claimed_at = null
  where id = p_id
    and status = 'claimed'
    and claim_id = p_claim_id;

  if found then
    insert into public.user_invitation_audit (
      invitation_id,
      event_name
    )
    values (p_id, 'released');
  end if;
end;
$$;

create function public.revoke_user_invitation(
  p_id uuid,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_invitation public.user_invitations;
begin
  select *
  into v_invitation
  from public.user_invitations
  where id = p_id
  for update;

  if not found or v_invitation.status = 'revoked' then
    raise exception using
      errcode = 'P0001',
      message = 'INVITATION_INVALID';
  end if;
  if v_invitation.status = 'redeemed' then
    raise exception using
      errcode = 'P0001',
      message = 'INVITATION_REDEEMED';
  end if;
  if v_invitation.status = 'claimed'
    and v_invitation.claimed_at >= now() - interval '5 minutes'
  then
    raise exception using
      errcode = 'P0001',
      message = 'INVITATION_BUSY';
  end if;
  if v_invitation.claim_id is not null
    and exists (
      select 1
      from auth.users auth_user
      where lower(auth_user.email) = v_invitation.email
        and auth_user.raw_app_meta_data
          ->> 'baan_ngern_dee_invitation_id'
            = v_invitation.id::text
        and auth_user.raw_app_meta_data
          ->> 'baan_ngern_dee_invitation_claim_id'
            = v_invitation.claim_id::text
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'INVITATION_BUSY';
  end if;

  update public.user_invitations
  set
    status = 'revoked',
    claim_id = null,
    claimed_at = null,
    revoked_at = now()
  where id = p_id;

  insert into public.user_invitation_audit (
    invitation_id,
    actor_user_id,
    event_name
  )
  values (p_id, p_actor, 'revoked');
end;
$$;

create function public.replace_user_invitation(
  p_original_id uuid,
  p_token_hash text,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_original public.user_invitations;
  v_replacement public.user_invitations;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_actor::text, 0)
  );

  select *
  into v_original
  from public.user_invitations
  where id = p_original_id
  for update;

  if not found or v_original.status = 'revoked' then
    raise exception using
      errcode = 'P0001',
      message = 'INVITATION_INVALID';
  end if;
  if v_original.status = 'redeemed' then
    raise exception using
      errcode = 'P0001',
      message = 'INVITATION_REDEEMED';
  end if;
  if v_original.status = 'claimed'
    and v_original.claimed_at >= now() - interval '5 minutes'
  then
    raise exception using
      errcode = 'P0001',
      message = 'INVITATION_BUSY';
  end if;
  if public.invitation_auth_user_exists(v_original.email) then
    raise exception using
      errcode = 'P0001',
      message = 'EMAIL_ALREADY_REGISTERED';
  end if;
  if (
    select count(*)
    from public.user_invitation_audit
    where actor_user_id = p_actor
      and event_name in ('created', 'replaced')
      and created_at > now() - interval '1 hour'
  ) >= 20 then
    raise exception using
      errcode = 'P0001',
      message = 'INVITATION_CREATE_FAILED';
  end if;

  update public.user_invitations
  set
    status = 'revoked',
    claim_id = null,
    claimed_at = null,
    revoked_at = now()
  where id = v_original.id;

  insert into public.user_invitations (
    email,
    display_name,
    token_hash,
    created_by,
    expires_at
  )
  values (
    v_original.email,
    v_original.display_name,
    p_token_hash,
    p_actor,
    now() + interval '24 hours'
  )
  returning * into v_replacement;

  insert into public.user_invitation_audit (
    invitation_id,
    actor_user_id,
    event_name,
    metadata
  )
  values (
    v_replacement.id,
    p_actor,
    'replaced',
    jsonb_build_object('replacedInvitationId', v_original.id)
  );

  return jsonb_build_object(
    'id', v_replacement.id,
    'email', v_replacement.email,
    'displayName', v_replacement.display_name,
    'status', v_replacement.status,
    'createdAt', v_replacement.created_at,
    'expiresAt', v_replacement.expires_at
  );
end;
$$;

revoke all on function public.invitation_auth_user_exists(text)
  from public, anon, authenticated;
revoke all on function public.create_user_invitation(
  text, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.list_user_invitations()
  from public, anon, authenticated;
revoke all on function public.inspect_user_invitation(text)
  from public, anon, authenticated;
revoke all on function public.reconcile_user_invitation(text)
  from public, anon, authenticated;
revoke all on function public.claim_user_invitation(text)
  from public, anon, authenticated;
revoke all on function public.complete_user_invitation(
  uuid, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.release_user_invitation(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.revoke_user_invitation(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.replace_user_invitation(
  uuid, text, uuid
) from public, anon, authenticated;

grant execute on function public.invitation_auth_user_exists(text)
  to service_role;
grant execute on function public.create_user_invitation(
  text, text, text, uuid
) to service_role;
grant execute on function public.list_user_invitations()
  to service_role;
grant execute on function public.inspect_user_invitation(text)
  to service_role;
grant execute on function public.reconcile_user_invitation(text)
  to service_role;
grant execute on function public.claim_user_invitation(text)
  to service_role;
grant execute on function public.complete_user_invitation(
  uuid, uuid, uuid
) to service_role;
grant execute on function public.release_user_invitation(uuid, uuid)
  to service_role;
grant execute on function public.revoke_user_invitation(uuid, uuid)
  to service_role;
grant execute on function public.replace_user_invitation(
  uuid, text, uuid
) to service_role;
