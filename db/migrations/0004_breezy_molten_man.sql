ALTER TABLE `webhook_deliveries` MODIFY COLUMN `received_at` timestamp(6) NOT NULL DEFAULT (now(6));--> statement-breakpoint
ALTER TABLE `users` ADD `token_version` int DEFAULT 0 NOT NULL;