ALTER TABLE auth_users ADD COLUMN role text NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin'));
ALTER TABLE skills ADD COLUMN slug text;
UPDATE skills SET slug=id;
ALTER TABLE skills ALTER COLUMN slug SET NOT NULL;
CREATE UNIQUE INDEX skills_owner_slug_idx ON skills(owner,slug);
ALTER TABLE skills ADD COLUMN community_version text;
ALTER TABLE skills ADD CONSTRAINT skills_community_version_fk FOREIGN KEY(id,community_version) REFERENCES versions(skill_id,version);
ALTER TABLE versions ADD COLUMN metadata text NOT NULL DEFAULT '{}';
UPDATE versions v SET metadata=json_build_object('name',s.name,'description',s.description,'category',s.category,'agents',s.agents::json,'tags',s.tags::json,'license',s.license,'sourcePath',s.source_path)::text FROM skills s WHERE s.id=v.skill_id;
CREATE TABLE community_reviews (
  id text PRIMARY KEY, skill_id text NOT NULL, version text NOT NULL,
  submitter text NOT NULL REFERENCES auth_users(id),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','withdrawn')),
  reason text NOT NULL DEFAULT '', reviewer text REFERENCES auth_users(id),
  created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz,
  FOREIGN KEY(skill_id,version) REFERENCES versions(skill_id,version)
);
CREATE UNIQUE INDEX community_reviews_active_idx ON community_reviews(skill_id,version) WHERE status IN ('pending','approved');
CREATE INDEX community_reviews_status_idx ON community_reviews(status,created_at);
-- Existing uploads stay private. Only bundled public upstream snapshots are pre-existing community examples.
UPDATE skills s SET community_version=(SELECT v.version FROM versions v WHERE v.skill_id=s.id ORDER BY split_part(v.version,'.',1)::integer DESC,split_part(v.version,'.',2)::integer DESC,split_part(v.version,'.',3)::integer DESC LIMIT 1) WHERE owner='upstream-catalog';
ALTER TABLE messages ADD COLUMN deleted_at timestamptz;
ALTER TABLE messages ADD COLUMN deleted_by text REFERENCES auth_users(id);
