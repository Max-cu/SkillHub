CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`author` text NOT NULL,
	`content` text NOT NULL,
	`color` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `messages_created_idx` ON `messages` (`created_at`,`id`);