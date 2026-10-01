-- Atomic fixed-window rate limiting. INSERT ... ON CONFLICT DO UPDATE takes a
-- row lock per key, so concurrent requests serialize on the counter and cannot
-- slip past the limit. Rejected requests still increment the counter but never
-- extend the window.

create or replace function rate_limit_hit(
  p_key text,
  p_window_seconds integer,
  p_max_count integer
) returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_row public.rate_limits;
begin
  insert into public.rate_limits as rl (key, window_start, count)
  values (p_key, v_now, 1)
  on conflict (key) do update set
    count = case
      when rl.window_start <= v_now - make_interval(secs => p_window_seconds) then 1
      else rl.count + 1
    end,
    window_start = case
      when rl.window_start <= v_now - make_interval(secs => p_window_seconds) then v_now
      else rl.window_start
    end
  returning rl.* into v_row;

  if v_row.count > p_max_count then
    return query select
      false,
      greatest(
        1,
        ceil(extract(epoch from
          v_row.window_start + make_interval(secs => p_window_seconds) - v_now
        ))::integer
      );
  else
    return query select true, 0;
  end if;
end;
$$;

-- Resets a counter (successful login clears failed attempts).
create or replace function rate_limit_reset(p_key text)
returns void
language sql
set search_path = ''
as $$
  delete from public.rate_limits where key = p_key;
$$;

-- Keep the hardened access model for all database functions: only the service
-- role may call them, client roles get nothing.
revoke all on function rate_limit_hit(text, integer, integer) from public, anon, authenticated;
revoke all on function rate_limit_reset(text) from public, anon, authenticated;
revoke all on function match_chunks(uuid, uuid[], extensions.vector(__EMBEDDING_DIMENSIONS__), integer, double precision)
  from public, anon, authenticated;
