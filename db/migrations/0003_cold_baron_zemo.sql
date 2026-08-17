CREATE TABLE `webhook_deliveries` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL DEFAULT 0,
	`key_id` int,
	`key_name` varchar(120),
	`outcome` enum('received','blocked') NOT NULL,
	`event_count` int NOT NULL,
	`events` json NOT NULL,
	`received_at` timestamp(6) NOT NULL DEFAULT (now(6)),
	CONSTRAINT `webhook_deliveries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `webhook_deliveries_user_idx` ON `webhook_deliveries` (`user_id`);--> statement-breakpoint
CREATE INDEX `webhook_deliveries_received_at_idx` ON `webhook_deliveries` (`received_at`);