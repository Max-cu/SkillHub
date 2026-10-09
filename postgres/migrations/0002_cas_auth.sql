CREATE TABLE auth_users (
  id text PRIMARY KEY, cas_subject text NOT NULL UNIQUE, display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_sessions (
  token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES auth_users(id),
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
CREATE INDEX auth_sessions_expiry_idx ON auth_sessions(expires_at);
CREATE TABLE auth_attempts (
  token_hash text PRIMARY KEY, expires_at timestamptz NOT NULL
);
CREATE TABLE auth_tickets (
  ticket_hash text PRIMARY KEY, expires_at timestamptz NOT NULL
);
-- Legacy workspace records remain unclaimed. No account is assigned their ownership.
