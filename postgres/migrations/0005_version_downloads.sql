-- Download counter per version. Incremented on authenticated /download ZIP requests
-- (inline SKILL.md views and package metadata are not counted).
ALTER TABLE versions ADD COLUMN downloads_count integer NOT NULL DEFAULT 0;
