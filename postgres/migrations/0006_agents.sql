-- AgentHub entities. Separate from skills.agents, which remains agent-compat tags.
CREATE TABLE agents (
  id text PRIMARY KEY,
  slug text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  owner text NOT NULL,
  config text NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE UNIQUE INDEX agents_owner_slug_idx ON agents (owner, slug);
CREATE INDEX agents_owner_updated_idx ON agents (owner, updated_at);
