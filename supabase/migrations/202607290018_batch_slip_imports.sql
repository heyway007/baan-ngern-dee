create or replace function public.get_slip_analysis_quota(
  p_workspace_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_used integer;
begin
  if auth.uid() is null
    or not public.is_workspace_member(p_workspace_id)
  then
    raise exception using errcode = '42501',
      message = 'workspace access denied';
  end if;

  select count(*) into v_used
  from public.slip_analysis_attempts
  where workspace_id = p_workspace_id
    and attempted_at >= (
      date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
    );

  return jsonb_build_object('used', v_used, 'limit', 30);
end;
$$;

create or replace function public.consume_slip_analysis_quota(
  p_workspace_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_workspace_count integer;
begin
  if v_user_id is null
    or not public.is_workspace_member(p_workspace_id)
  then
    raise exception using errcode = '42501',
      message = 'workspace access denied';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_workspace_id::text));

  delete from public.slip_analysis_attempts
  where attempted_at < now() - interval '24 hours';

  select count(*) into v_workspace_count
  from public.slip_analysis_attempts
  where workspace_id = p_workspace_id
    and attempted_at >= (
      date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
    );

  if v_workspace_count >= 30 then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'workspace_day',
      'used', 30,
      'limit', 30
    );
  end if;

  insert into public.slip_analysis_attempts (workspace_id, user_id)
  values (p_workspace_id, v_user_id);

  return jsonb_build_object(
    'allowed', true,
    'used', v_workspace_count + 1,
    'limit', 30
  );
end;
$$;

revoke all on function public.get_slip_analysis_quota(uuid)
  from public, anon, authenticated;
revoke all on function public.consume_slip_analysis_quota(uuid)
  from public, anon, authenticated;
grant execute on function public.get_slip_analysis_quota(uuid)
  to authenticated;
grant execute on function public.consume_slip_analysis_quota(uuid)
  to authenticated;
