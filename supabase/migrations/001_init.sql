-- Initial schema. __EMBEDDING_DIMENSIONS__ is replaced by scripts/db-apply.mjs
-- from OPENAI_EMBEDDING_DIMENSIONS so the vector column always matches the env.

create extension if not exists vector;

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists notebooks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notebooks_session_idx on notebooks(session_id);

create table if not exists sources (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references notebooks(id) on delete cascade,
  filename text not null,
  mime_type text not null,
  size_bytes integer not null,
  storage_path text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'ready', 'error')),
  error_message text,
  page_count integer,
  extracted_chars integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sources_notebook_idx on sources(notebook_id);

create table if not exists chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade,
  notebook_id uuid not null references notebooks(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  token_count integer not null,
  page_start integer,
  page_end integer,
  section_path text,
  embedding vector(__EMBEDDING_DIMENSIONS__) not null
);
create index if not exists chunks_notebook_idx on chunks(notebook_id);
create index if not exists chunks_source_idx on chunks(source_id);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references notebooks(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  citations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists messages_notebook_idx on messages(notebook_id, created_at);

create table if not exists embedding_config (
  id integer primary key default 1 check (id = 1),
  model_name text not null,
  dimensions integer not null,
  created_at timestamptz not null default now()
);

create table if not exists rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count integer not null default 0
);

-- Vector search scoped to one notebook and an explicit source list.
-- Exact scan (no ANN index) is intentional at demo scale (<~10k chunks).
create or replace function match_chunks(
  p_notebook_id uuid,
  p_source_ids uuid[],
  p_query_embedding vector(__EMBEDDING_DIMENSIONS__),
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
as $$
  select
    c.id,
    c.source_id,
    c.chunk_index,
    c.content,
    c.page_start,
    c.page_end,
    c.section_path,
    1 - (c.embedding <=> p_query_embedding) as similarity
  from chunks c
  where c.notebook_id = p_notebook_id
    and c.source_id = any(p_source_ids)
    and 1 - (c.embedding <=> p_query_embedding) >= p_min_similarity
  order by c.embedding <=> p_query_embedding
  limit p_match_count
$$;
