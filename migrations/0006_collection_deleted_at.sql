-- Owner-deleted shared lists. Deleting doesn't drop the rows right away: each
-- remaining member's client still needs to read the encrypted blob once to
-- turn its titles into a plain personal list (the server can't do that, it
-- can't decrypt). So DELETE sets deleted_at, removes the owner's membership,
-- and revokes open invites; every write endpoint refuses a deleted list; and
-- the collection, blob, and invites are purged when the last member leaves
-- (see purgeIfEmpty in src/lib/server/collections.ts). Additive and nullable:
-- existing rows read as "not deleted".
ALTER TABLE collections ADD COLUMN deleted_at TEXT;
