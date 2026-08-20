-- Collaborative Collections (#145 / #187): a Collection whose contents are
-- shared between several accounts, end-to-end encrypted, with each member
-- holding their own wrapped copy of one shared Collection DEK.
--
-- Why not reuse `wrapped_dek` (0001): that table is keyed (user_id, method)
-- with CHECK(method IN ('passphrase','recovery','passkey')) — it models "one
-- user, N credentials for their own single DEK". Collections are the other
-- shape entirely: "one DEK, N users". Overloading it would mean dropping the
-- CHECK and smuggling a collection id through `method`.
--
-- Wrapping key: each member's `wrapped_key` below is the Collection DEK
-- encrypted under that member's *personal sync DEK* — not under a
-- passphrase-derived key. The design doc on #145 assumed a persistent
-- passphrase-derived `encKey`, which does not exist: crypto.ts's encrypt()
-- takes a passphrase string and derives per-call with a fresh salt, and
-- signIn() discards the passphrase once it has unwrapped the personal DEK.
-- Chaining off the personal DEK instead means invite acceptance needs no
-- passphrase re-prompt, and — more importantly — collection access survives
-- passphrase changes and account recovery for free, since finishRecovery()
-- re-wraps only the personal DEK and knows nothing about collections.
-- Accepted consequence: the personal DEK is the root of collection access,
-- so recovering an account also recovers its collections.

CREATE TABLE IF NOT EXISTS collections (
  id                TEXT    PRIMARY KEY,          -- uuid, generated client-side at creation
  owner_user_id     TEXT    NOT NULL REFERENCES users(id),
  name              TEXT    NOT NULL,             -- plaintext: shown in invite UI before the invitee holds the DEK
  dek_version       INTEGER NOT NULL DEFAULT 1,   -- bumped on every rotation (see collection_blobs)
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One row per member per collection. The presence of a row IS the membership
-- grant — every endpoint authorises by looking for one, never by trusting a
-- collection_id from the request alone.
CREATE TABLE IF NOT EXISTS collection_members (
  collection_id   TEXT    NOT NULL REFERENCES collections(id),
  user_id         TEXT    NOT NULL REFERENCES users(id),
  wrapped_key     TEXT    NOT NULL,               -- Collection DEK, wrapped under this member's personal sync DEK
  dek_version     INTEGER NOT NULL,               -- which generation `wrapped_key` unwraps; compared against collections.dek_version
  role            TEXT    NOT NULL DEFAULT 'member' CHECK(role IN ('owner', 'member')),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (collection_id, user_id)
);

-- Listing "collections I belong to" is the hot path on app load and would
-- otherwise scan; the PK is (collection_id, user_id) so it can't serve a
-- user_id-leading lookup.
CREATE INDEX IF NOT EXISTS idx_collection_members_user
  ON collection_members(user_id);

-- Mirrors sync_blobs, including the version column used for the same
-- optimistic-concurrency 409 dance. `dek_version` travels with the blob so a
-- client can tell "this is encrypted under a generation I don't hold yet"
-- (re-fetch my wrapped key) apart from generic decryption failure (corrupt
-- data) — without it, an interrupted key rotation surfaces to the user as
-- data corruption.
CREATE TABLE IF NOT EXISTS collection_blobs (
  collection_id   TEXT    PRIMARY KEY REFERENCES collections(id),
  blob            TEXT    NOT NULL,
  version         INTEGER NOT NULL DEFAULT 0,
  dek_version     INTEGER NOT NULL DEFAULT 1,
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Invites are bearer credentials that carry key material: the Collection DEK
-- rides in the URL fragment, so whoever holds the link holds the key itself,
-- not merely permission to ask for it. Hence single-use (claimed_at),
-- explicitly revocable (revoked_at), and expiring (expires_at) — all three,
-- not one of the three. The token stored here is a hash, so a leaked database
-- snapshot doesn't yield working invite links.
CREATE TABLE IF NOT EXISTS collection_invites (
  token_hash      TEXT    PRIMARY KEY,            -- SHA-256 of the invite token; the token itself is never stored
  collection_id   TEXT    NOT NULL REFERENCES collections(id),
  created_by      TEXT    NOT NULL REFERENCES users(id),
  expires_at      TEXT    NOT NULL,
  claimed_at      TEXT,                           -- NULL until redeemed; set once, making the invite single-use
  claimed_by      TEXT    REFERENCES users(id),
  revoked_at      TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- "Show me outstanding invites for this collection" (the revoke UI).
CREATE INDEX IF NOT EXISTS idx_collection_invites_collection
  ON collection_invites(collection_id);
