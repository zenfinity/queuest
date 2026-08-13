-- Key custody and recovery (#102). A lost passphrase is unrecoverable data
-- loss by design (end-to-end encryption, no server-side backdoor) — this
-- table is the one exception the design allows: a second, independent
-- credential (a high-entropy printed recovery code) that can re-authenticate
-- the user and hand back the wrapped_dek(method='recovery') row, without
-- ever letting the server see the passphrase, the code, or the DEK itself.
--
-- Deliberately its own table rather than a second row shape on `users` —
-- `users.auth_key_hash` stays exactly what it's always been (the passphrase
-- credential), so passphrase signin is untouched by this migration.
CREATE TABLE IF NOT EXISTS recovery_auth (
  user_id         TEXT    PRIMARY KEY REFERENCES users(id),
  auth_key_hash   TEXT    NOT NULL, -- hash of the recovery-code-derived auth key (same derivation as passphrase's)
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
