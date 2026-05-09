CREATE TABLE IF NOT EXISTS watchlist (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tmdb_id         INTEGER NOT NULL,
  media_type      TEXT    NOT NULL CHECK(media_type IN ('movie', 'tv')),
  title           TEXT    NOT NULL,
  poster_path     TEXT,
  overview        TEXT,
  providers       TEXT    NOT NULL DEFAULT '[]',
  runtime_minutes INTEGER,
  added_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  watched_at      TEXT,
  UNIQUE(tmdb_id, media_type)
);

