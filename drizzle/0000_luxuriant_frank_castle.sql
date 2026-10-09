CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`hash` text NOT NULL,
	`prefix` text NOT NULL,
	`scope` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_hash_unique` ON `api_keys` (`hash`);--> statement-breakpoint
CREATE TABLE `favorites` (
	`user_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `skill_id`),
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`task` text NOT NULL,
	`agent` text NOT NULL,
	`items` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`agents` text NOT NULL,
	`tags` text NOT NULL,
	`source` text NOT NULL,
	`source_path` text NOT NULL,
	`commit` text,
	`license` text NOT NULL,
	`owner` text NOT NULL,
	`featured` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `versions` (
	`skill_id` text NOT NULL,
	`version` text NOT NULL,
	`markdown` text NOT NULL,
	`digest` text NOT NULL,
	`commit` text,
	`changelog` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`skill_id`, `version`),
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE no action
);
