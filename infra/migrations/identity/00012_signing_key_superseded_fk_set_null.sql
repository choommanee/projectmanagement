-- +goose Up
-- signing_key.superseded_by is bookkeeping metadata ("which key replaced me"),
-- not a hard ownership edge. With the default NO ACTION constraint, deleting a
-- signing key that any other row references via superseded_by fails, which
-- silently broke test cleanups (errors are ignored) and let the table
-- accumulate hundreds of orphaned test keys — the pollution that contributed
-- to the platform-wide 401 incident. ON DELETE SET NULL lets keys be pruned
-- while keeping the lineage metadata best-effort.
ALTER TABLE signing_key
  DROP CONSTRAINT signing_key_superseded_by_fkey;
ALTER TABLE signing_key
  ADD CONSTRAINT signing_key_superseded_by_fkey
  FOREIGN KEY (superseded_by) REFERENCES signing_key(kid) ON DELETE SET NULL;

-- +goose Down
ALTER TABLE signing_key
  DROP CONSTRAINT signing_key_superseded_by_fkey;
ALTER TABLE signing_key
  ADD CONSTRAINT signing_key_superseded_by_fkey
  FOREIGN KEY (superseded_by) REFERENCES signing_key(kid);
