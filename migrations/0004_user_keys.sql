-- Per-user keypairs (#189). Collaborative Collections need one member to be
-- able to encrypt a key *for* another member — specifically, to re-wrap a
-- rotated Collection DEK for everyone who remains after a removal.
--
-- That is impossible with the symmetric-only design #187 shipped: a member's
-- wrapped_key was encrypted under their own personal sync DEK, which is
-- non-extractable and lives only in their own browser. Alice cannot produce a
-- wrapped key for Carol, so rotation-on-removal could not be built at all.
--
-- With a keypair, Alice wraps the new Collection DEK under Carol's *public*
-- key and Carol unwraps it with her private key. A removed member cannot
-- obtain the new DEK regardless of what the server does or how it is
-- compromised — the property the alternative (a server-gated rekey chain)
-- could not offer, since that one rested on the server refusing to hand over
-- a key the removed member could otherwise still decrypt.
--
-- Its own table rather than columns on `users`, following the precedent set
-- by recovery_auth in 0002: `users` stays exactly what it has always been,
-- and "this account has no keypair yet" is an absent row rather than a pair
-- of nullable columns that every read has to remember to check.
--
-- The private key is wrapped under the account's personal sync DEK, so it
-- inherits that key's lifecycle for free: passphrase changes and account
-- recovery both re-wrap only the personal DEK (see finishRecovery), and the
-- private key — and therefore every collection the user belongs to — comes
-- along without any additional bookkeeping.
CREATE TABLE IF NOT EXISTS user_keys (
  user_id             TEXT    PRIMARY KEY REFERENCES users(id),
  -- SPKI, b64url. Public by design: served to fellow collection members so
  -- they can wrap keys for this user.
  public_key          TEXT    NOT NULL,
  -- PKCS8, encrypted under the user's personal sync DEK. The server stores it
  -- so the keypair follows the account across devices, and can never read it.
  wrapped_private_key TEXT    NOT NULL,
  algorithm           TEXT    NOT NULL DEFAULT 'RSA-OAEP-2048-SHA256',
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);
