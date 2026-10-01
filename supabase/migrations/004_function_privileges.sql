-- Close the remaining default-privileges gap: new functions in public would
-- otherwise be executable by client roles again (Postgres grants EXECUTE to
-- PUBLIC by default). Also sweep all existing functions once.

alter default privileges in schema public
  revoke all on functions from public, anon, authenticated;

revoke all on all functions in schema public from public, anon, authenticated;
