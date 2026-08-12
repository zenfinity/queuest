-- Sync epic (#79) server schema: users, encrypted sync blobs, and wrapped
-- data-encryption-keys. Billing is deferred (see #95) — `plan` and
-- `entitled_until` ship now so enabling it later is a column read, not a
-- migration against live user rows. Default everyone to entitled.

CREATE TABLE IF NOT EXISTS users (
  id              TEXT    PRIMARY KEY, -- uuid, generated at signup
  email           TEXT    NOT NULL UNIQUE,
  auth_key_hash   TEXT    NOT NULL,    -- hash of the passphrase-derived auth key
  salt            TEXT    NOT NULL,    -- PBKDF2 salt used to derive auth_key from the passphrase
  plan            TEXT    NOT NULL DEFAULT 'free',
  entitled_until  TEXT,                -- NULL = entitled indefinitely (default, pre-billing)
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sync_blobs (
  user_id     TEXT    PRIMARY KEY REFERENCES users(id),
  blob        TEXT    NOT NULL,     -- encrypted watchlist payload
  version     INTEGER NOT NULL DEFAULT 0, -- optimistic-concurrency token; bumped on every write
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wrapped_dek (
  user_id       TEXT    NOT NULL REFERENCES users(id),
  method        TEXT    NOT NULL CHECK(method IN ('passphrase', 'recovery', 'passkey')),
  wrapped_key   TEXT    NOT NULL, -- the DEK, wrapped under this method's derived/unwrapping key
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, method)
);
