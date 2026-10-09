#!/usr/bin/env bash
set -euo pipefail
qa=skillhub-cas-qa-skillhub-postgres-1
test "$(docker inspect --format '{{index .Config.Labels "skillhub-purpose"}}' "$qa")" = cas-qa
test "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$qa")" = skillhub-cas-qa
docker exec "$qa" psql -U skillhub_admin -d postgres -v ON_ERROR_STOP=1 -c 'CREATE DATABASE skillhub_migration_qa;' >/dev/null
for migration in postgres/migrations/0001_initial.sql postgres/migrations/0002_cas_auth.sql; do
 docker exec -i "$qa" psql -U skillhub_admin -d skillhub_migration_qa -v ON_ERROR_STOP=1 < "$migration" >/dev/null
done
docker exec -i "$qa" psql -U skillhub_admin -d skillhub_migration_qa -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
INSERT INTO auth_users(id,cas_subject,display_name) VALUES('cas:fixture','migration-fixture','Migration fixture');
INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES(repeat('a',64),'cas:fixture',now()+interval '1 hour');
INSERT INTO skills(id,name,description,category,agents,tags,source,source_path,license,owner,created_at) VALUES
('old-private','old-private','Old private description','development','["codex"]','["fixture"]','','SKILL.md','MIT','cas:fixture','2026-10-09'),
('old-example','old-example','Old public example','development','["codex"]','[]','','SKILL.md','MIT','upstream-catalog','2026-10-09');
INSERT INTO versions(skill_id,version,markdown,digest,changelog,created_at) VALUES
('old-private','1.0.0','Keep old markdown bytes','sha256:fixture','Original','2026-10-09'),
('old-example','1.0.0','Keep public example','sha256:example','Original','2026-10-09');
INSERT INTO packages(skill_id,version,digest,size,filename,root,files) VALUES('old-private','1.0.0','sha256:fixture',3,'old.zip','','[]');
INSERT INTO package_chunks(skill_id,version,chunk_index,content) VALUES('old-private','1.0.0',0,decode('0001ff','hex'));
INSERT INTO messages(id,owner,author,content,color,created_at) VALUES('old-note','cas:fixture','Fixture','Keep old note','yellow','2026-10-09');
SQL
docker exec -i "$qa" psql -U skillhub_admin -d skillhub_migration_qa -v ON_ERROR_STOP=1 < postgres/migrations/0003_community_roles.sql >/dev/null
docker exec -i "$qa" psql -U skillhub_admin -d skillhub_migration_qa -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
DO $$ BEGIN
 IF (SELECT role FROM auth_users WHERE id='cas:fixture') <> 'user' THEN RAISE EXCEPTION 'Existing user elevated'; END IF;
 IF (SELECT community_version FROM skills WHERE id='old-private') IS NOT NULL THEN RAISE EXCEPTION 'Existing upload became public'; END IF;
 IF (SELECT community_version FROM skills WHERE id='old-example') <> '1.0.0' THEN RAISE EXCEPTION 'Bundled example unavailable'; END IF;
 IF (SELECT owner FROM skills WHERE id='old-private') <> 'cas:fixture' THEN RAISE EXCEPTION 'Ownership changed'; END IF;
 IF (SELECT slug FROM skills WHERE id='old-private') <> 'old-private' THEN RAISE EXCEPTION 'Legacy ID/slug changed'; END IF;
 IF (SELECT markdown FROM versions WHERE skill_id='old-private') <> 'Keep old markdown bytes' THEN RAISE EXCEPTION 'Content changed'; END IF;
 IF (SELECT metadata::json->>'description' FROM versions WHERE skill_id='old-private') <> 'Old private description' THEN RAISE EXCEPTION 'Snapshot backfill failed'; END IF;
 IF (SELECT encode(content,'hex') FROM package_chunks WHERE skill_id='old-private') <> '0001ff' THEN RAISE EXCEPTION 'ZIP bytes changed'; END IF;
 IF (SELECT content FROM messages WHERE id='old-note') <> 'Keep old note' OR (SELECT deleted_at FROM messages WHERE id='old-note') IS NOT NULL THEN RAISE EXCEPTION 'Old note altered'; END IF;
 IF (SELECT count(*) FROM auth_sessions WHERE user_id='cas:fixture' AND expires_at>now()) <> 1 THEN RAISE EXCEPTION 'Session changed'; END IF;
 IF (SELECT count(*) FROM community_reviews) <> 0 THEN RAISE EXCEPTION 'Synthetic review created'; END IF;
END $$;
SQL
echo 'COMMUNITY_MIGRATION_PASS; existing owner, IDs, notes, ZIP bytes and sessions retained; default user; old uploads private'
docker exec "$qa" psql -U skillhub_admin -d skillhub_migration_qa -v ON_ERROR_STOP=1 -c "UPDATE auth_users SET role='admin' WHERE id='cas:fixture';" >/dev/null
docker exec -i "$qa" psql -U skillhub_admin -d skillhub_migration_qa -v ON_ERROR_STOP=1 < postgres/migrations/0004_ai_workflows.sql >/dev/null
docker exec -i "$qa" psql -U skillhub_admin -d skillhub_migration_qa -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
DO $$ BEGIN
 IF (SELECT role FROM auth_users WHERE id='cas:fixture') <> 'admin' THEN RAISE EXCEPTION 'Manual admin role lost'; END IF;
 IF (SELECT ai_status FROM versions WHERE skill_id='old-private') <> 'unprocessed' THEN RAISE EXCEPTION 'Old upload unexpectedly queued'; END IF;
 IF (SELECT count(*) FROM ai_jobs) <> 0 THEN RAISE EXCEPTION 'Synthetic AI job created'; END IF;
 IF (SELECT encode(content,'hex') FROM package_chunks WHERE skill_id='old-private') <> '0001ff' THEN RAISE EXCEPTION 'Original bytes changed'; END IF;
END $$;
SQL
echo 'AI_MIGRATION_PASS; manually assigned admin role and original package retained; old records not automatically sent to AI'
