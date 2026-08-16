CREATE TABLE `api_keys` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL DEFAULT 0,
	`name` varchar(120) NOT NULL,
	`key_hash` varchar(64) NOT NULL,
	`key_hint` varchar(4) NOT NULL,
	`last_used_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `api_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `api_keys_hash_idx` UNIQUE(`key_hash`)
);
--> statement-breakpoint
CREATE INDEX `api_keys_user_idx` ON `api_keys` (`user_id`);