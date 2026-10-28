CREATE TABLE users (
 id uuid PRIMARY KEY, telegram_id bigint UNIQUE NOT NULL,
 display_name text NOT NULL, username text, avatar_url text,
 notifications boolean NOT NULL DEFAULT false, share_name boolean NOT NULL DEFAULT true,
 consent_version text, disabled boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
 id uuid PRIMARY KEY, token_hash text UNIQUE NOT NULL, user_id uuid NOT NULL REFERENCES users(id),
 csrf_token text NOT NULL, mode text NOT NULL CHECK(mode IN ('telegram','demo')),
 created_at timestamptz NOT NULL DEFAULT now(), last_seen timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL, bearer_expires_at timestamptz NOT NULL, revoked_at timestamptz
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE auth_bootstraps (
 digest text PRIMARY KEY, request_id uuid NOT NULL, session_id uuid NOT NULL REFERENCES sessions(id),
 encrypted_token text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE artworks (
 id text PRIMARY KEY, version_id text UNIQUE NOT NULL, title text NOT NULL, description text NOT NULL,
 author text NOT NULL, category text NOT NULL, width integer NOT NULL CHECK(width BETWEEN 1 AND 256),
 height integer NOT NULL CHECK(height BETWEEN 1 AND 256), color_count integer NOT NULL CHECK(color_count BETWEEN 1 AND 256),
 total integer NOT NULL CHECK(total > 0), grid_key text NOT NULL, grid_sha256 text NOT NULL,
 featured boolean NOT NULL DEFAULT false, published_at timestamptz NOT NULL,
 published boolean NOT NULL DEFAULT true, restricted boolean NOT NULL DEFAULT false
);
CREATE TABLE grants (
 user_id uuid NOT NULL REFERENCES users(id), version_id text NOT NULL REFERENCES artworks(version_id),
 created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
 PRIMARY KEY(user_id,version_id)
);
CREATE TABLE runs (
 id uuid PRIMARY KEY, ordinal bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 user_id uuid NOT NULL REFERENCES users(id), version_id text NOT NULL REFERENCES artworks(version_id),
 filled integer[] NOT NULL DEFAULT '{}', status text NOT NULL CHECK(status IN ('active','completed','interrupted')) DEFAULT 'active',
 revision integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 CHECK ((status='completed') = (completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX one_active_run ON runs(user_id,version_id) WHERE status='active';
CREATE INDEX runs_latest ON runs(user_id,version_id,ordinal DESC);
CREATE TABLE progress_mutations (
 run_id uuid NOT NULL REFERENCES runs(id), mutation_id uuid NOT NULL, request_digest text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(run_id,mutation_id)
);
CREATE TABLE collection (
 user_id uuid NOT NULL REFERENCES users(id), version_id text NOT NULL REFERENCES artworks(version_id),
 run_id uuid NOT NULL REFERENCES runs(id), first_completed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,version_id)
);
CREATE TABLE support_tickets (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), kind text NOT NULL CHECK(kind IN ('help','content_report','deletion')),
 message text NOT NULL CHECK(length(message) BETWEEN 1 AND 4000), work_id text REFERENCES artworks(id),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
 created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz, resolution text
);
CREATE TABLE telegram_inbox (
 bot_id text NOT NULL, update_id bigint NOT NULL, payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','done','unknown','failed')),
 attempts integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
 processed_at timestamptz, lease_until timestamptz, error_code text,
 PRIMARY KEY(bot_id,update_id)
);
CREATE TABLE audit_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor text NOT NULL, action text NOT NULL,
 subject text NOT NULL, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
