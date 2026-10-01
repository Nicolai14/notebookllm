-- Security hardening (Supabase advisor findings):
-- 1. Enable RLS on all app tables. The app uses the service role key (bypasses
--    RLS); enabling RLS without policies denies all direct access via the
--    anon/publishable keys. Authorization stays in the app layer by design
--    (docs/architecture.md section 4).
-- 2. Revoke table privileges from client roles as defense in depth.
-- 3. Move the vector extension out of the public schema.
-- 4. Pin the search_path of match_chunks and qualify all references.

alter table sessions enable row level security;
alter table notebooks enable row level security;
alter table sources enable row level security;
alter table chunks enable row level security;
alter table messages enable row level security;
alter table embedding_config enable row level security;
alter table rate_limits enable row level security;

revoke all on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;

create schema if not exists extensions;
do $$
begin
  if exists (
    select 1 from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'vector' and n.nspname = 'public'
  ) then
    alter extension vector set schema extensions;
  end if;
end $$;

drop function if exists match_chunks(uuid, uuid[], extensions.vector, integer, double precision);

create or replace function match_chunks(
  p_notebook_id uuid,
  p_source_ids uuid[],
  p_query_embedding extensions.vector(__EMBEDDING_DIMENSIONS__),
  p_match_count integer,
  p_min_similarity double precision
) returns table (
  id uuid,
  source_id uuid,
  chunk_index integer,
  content text,
  page_start integer,
  page_end integer,
  section_path text,
  similarity double precision
)
language sql stable
set search_path = ''
as $$
  select
    c.id,
    c.source_id,
    c.chunk_index,
    c.content,
    c.page_start,
    c.page_end,
    c.section_path,
    1 - (c.embedding operator(extensions.<=>) p_query_embedding) as similarity
  from public.chunks c
  where c.notebook_id = p_notebook_id
    and c.source_id = any(p_source_ids)
    and 1 - (c.embedding operator(extensions.<=>) p_query_embedding) >= p_min_similarity
  order by c.embedding operator(extensions.<=>) p_query_embedding
  limit p_match_count
$$;
