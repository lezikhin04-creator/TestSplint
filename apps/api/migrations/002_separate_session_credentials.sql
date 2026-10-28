-- A script-readable fallback credential must never be usable as a long-lived cookie.
ALTER TABLE sessions ADD COLUMN bearer_token_hash text UNIQUE;

-- Early local builds used the same credential for both transports. Reopening the
-- application creates a session with independent cookie and fallback credentials.
UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE bearer_token_hash IS NULL;
