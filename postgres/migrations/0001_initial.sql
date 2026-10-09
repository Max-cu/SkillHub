CREATE TABLE skills (
  id text PRIMARY KEY, name text NOT NULL, description text NOT NULL,
  category text NOT NULL, agents text NOT NULL, tags text NOT NULL,
  source text NOT NULL, source_path text NOT NULL, "commit" text,
  license text NOT NULL, owner text NOT NULL, featured integer NOT NULL DEFAULT 0,
  created_at text NOT NULL
);
CREATE TABLE versions (
  skill_id text NOT NULL REFERENCES skills(id), version text NOT NULL,
  markdown text NOT NULL, digest text NOT NULL, "commit" text,
  changelog text NOT NULL, created_at text NOT NULL, PRIMARY KEY(skill_id,version)
);
CREATE TABLE favorites (
  user_id text NOT NULL, skill_id text NOT NULL REFERENCES skills(id),
  created_at text NOT NULL, PRIMARY KEY(user_id,skill_id)
);
CREATE TABLE api_keys (
  id text PRIMARY KEY, user_id text NOT NULL, name text NOT NULL, hash text NOT NULL UNIQUE,
  prefix text NOT NULL, scope text NOT NULL, created_at text NOT NULL
);
CREATE TABLE packages (
  skill_id text NOT NULL, version text NOT NULL, digest text NOT NULL, size integer NOT NULL,
  filename text NOT NULL, root text NOT NULL, files text NOT NULL, PRIMARY KEY(skill_id,version),
  FOREIGN KEY(skill_id,version) REFERENCES versions(skill_id,version)
);
CREATE TABLE package_chunks (
  skill_id text NOT NULL, version text NOT NULL, chunk_index integer NOT NULL, content bytea NOT NULL,
  PRIMARY KEY(skill_id,version,chunk_index), FOREIGN KEY(skill_id,version) REFERENCES packages(skill_id,version)
);
CREATE TABLE messages (
  id text PRIMARY KEY, owner text NOT NULL, author text NOT NULL, content text NOT NULL,
  color text NOT NULL, created_at text NOT NULL, position_x double precision, position_y double precision
);
CREATE INDEX messages_created_idx ON messages(created_at,id);
-- Preserve historical storage only; no recipe API or product entry exists.
CREATE TABLE recipes (
  id text PRIMARY KEY, user_id text NOT NULL, name text NOT NULL, task text NOT NULL,
  agent text NOT NULL, items text NOT NULL, created_at text NOT NULL
);
