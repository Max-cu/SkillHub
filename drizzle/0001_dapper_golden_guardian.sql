CREATE TABLE `package_chunks` (
	`skill_id` text NOT NULL,
	`version` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`content` blob NOT NULL,
	PRIMARY KEY(`skill_id`, `version`, `chunk_index`),
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `packages` (
	`skill_id` text NOT NULL,
	`version` text NOT NULL,
	`digest` text NOT NULL,
	`size` integer NOT NULL,
	`filename` text NOT NULL,
	`root` text NOT NULL,
	`files` text NOT NULL,
	PRIMARY KEY(`skill_id`, `version`),
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE no action
);
