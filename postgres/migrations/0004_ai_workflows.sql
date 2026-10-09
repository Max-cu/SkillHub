ALTER TABLE versions ADD COLUMN ai_status text NOT NULL DEFAULT 'unprocessed' CHECK(ai_status IN ('unprocessed','queued','running','ready','error'));
ALTER TABLE versions ADD COLUMN ai_summary text;
ALTER TABLE versions ADD COLUMN ai_category text;
ALTER TABLE versions ADD COLUMN ai_tags text;
ALTER TABLE skills ADD COLUMN community_blocked boolean NOT NULL DEFAULT false;
ALTER TABLE skills ADD COLUMN moderation_reason text NOT NULL DEFAULT '';
ALTER TABLE community_reviews ADD COLUMN decision_source text NOT NULL DEFAULT 'human' CHECK(decision_source IN ('human','ai'));
ALTER TABLE community_reviews ADD COLUMN ai_status text NOT NULL DEFAULT 'not_requested';
ALTER TABLE community_reviews ADD COLUMN ai_report text NOT NULL DEFAULT '{}';
ALTER TABLE community_reviews ADD COLUMN ai_model text;
ALTER TABLE community_reviews ADD COLUMN package_digest text;
CREATE TABLE ai_jobs (
 id text PRIMARY KEY,kind text NOT NULL CHECK(kind IN ('summary','review')),
 skill_id text NOT NULL,version text NOT NULL,review_id text REFERENCES community_reviews(id),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','done','error','cancelled')),
 attempts integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,claim_token text,
 error_code text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(skill_id,version) REFERENCES versions(skill_id,version)
);
CREATE UNIQUE INDEX ai_jobs_summary_idx ON ai_jobs(skill_id,version) WHERE kind='summary';
CREATE UNIQUE INDEX ai_jobs_review_idx ON ai_jobs(review_id) WHERE kind='review';
CREATE INDEX ai_jobs_queue_idx ON ai_jobs(status,available_at);
CREATE TABLE community_moderation (
 id text PRIMARY KEY,skill_id text NOT NULL REFERENCES skills(id),actor text NOT NULL REFERENCES auth_users(id),
 action text NOT NULL CHECK(action IN ('remove','unblock')),reason text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now()
);
