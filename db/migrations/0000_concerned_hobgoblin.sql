CREATE TABLE `alert_rules` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL DEFAULT 0,
	`name` varchar(255) NOT NULL,
	`type` enum('failure_rate_spike','latency_spike','error_rate_threshold','endpoint_down') NOT NULL,
	`endpoint` varchar(500),
	`threshold` float NOT NULL,
	`time_window_minutes` int NOT NULL DEFAULT 5,
	`enabled` int NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `alert_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `alerts` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL DEFAULT 0,
	`type` enum('failure_rate_spike','latency_spike','error_rate_threshold','endpoint_down') NOT NULL,
	`severity` enum('critical','warning','info') NOT NULL DEFAULT 'warning',
	`endpoint` varchar(500),
	`message` text NOT NULL,
	`details` json,
	`acknowledged` int NOT NULL DEFAULT 0,
	`acknowledged_by` bigint unsigned,
	`acknowledged_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `api_requests` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL DEFAULT 0,
	`endpoint` varchar(500) NOT NULL,
	`method` varchar(10) NOT NULL,
	`status_code` int NOT NULL,
	`latency_ms` int NOT NULL,
	`error_message` text,
	`request_headers` json,
	`response_size` int,
	`source_ip` varchar(45),
	`user_agent` varchar(500),
	`cost` float NOT NULL DEFAULT 0,
	`blocked` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `api_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `endpoints` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL DEFAULT 0,
	`path` varchar(500) NOT NULL,
	`method` varchar(10) NOT NULL,
	`total_requests` bigint unsigned NOT NULL DEFAULT 0,
	`successful_requests` bigint unsigned NOT NULL DEFAULT 0,
	`failed_requests` bigint unsigned NOT NULL DEFAULT 0,
	`avg_latency_ms` float NOT NULL DEFAULT 0,
	`max_latency_ms` int NOT NULL DEFAULT 0,
	`min_latency_ms` int NOT NULL DEFAULT 0,
	`p50_latency_ms` float NOT NULL DEFAULT 0,
	`p95_latency_ms` float NOT NULL DEFAULT 0,
	`p99_latency_ms` float NOT NULL DEFAULT 0,
	`last_requested_at` timestamp,
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `endpoints_id` PRIMARY KEY(`id`),
	CONSTRAINT `endpoints_user_path_method_idx` UNIQUE(`user_id`,`path`,`method`)
);
--> statement-breakpoint
CREATE TABLE `usage_alerts` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL DEFAULT 0,
	`limit_id` int NOT NULL,
	`endpoint` varchar(500) NOT NULL,
	`method` varchar(10) NOT NULL,
	`period` enum('daily','monthly') NOT NULL,
	`severity` enum('warning','critical','limit','reset') NOT NULL,
	`period_key` varchar(20) NOT NULL,
	`message` text NOT NULL,
	`details` json,
	`emailed` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `usage_alerts_id` PRIMARY KEY(`id`),
	CONSTRAINT `usage_alerts_dedupe_idx` UNIQUE(`limit_id`,`period`,`severity`,`period_key`)
);
--> statement-breakpoint
CREATE TABLE `usage_limits` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL DEFAULT 0,
	`endpoint` varchar(500) NOT NULL,
	`method` varchar(10) NOT NULL,
	`daily_limit` int,
	`monthly_limit` int,
	`cost_limit` float,
	`warning_threshold` float NOT NULL DEFAULT 80,
	`critical_threshold` float NOT NULL DEFAULT 95,
	`email_alerts` int NOT NULL DEFAULT 0,
	`rate_limiting` int NOT NULL DEFAULT 0,
	`last_daily_period_key` varchar(20),
	`last_monthly_period_key` varchar(20),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `usage_limits_id` PRIMARY KEY(`id`),
	CONSTRAINT `usage_limits_user_endpoint_method_idx` UNIQUE(`user_id`,`endpoint`,`method`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`email` varchar(320) NOT NULL,
	`password_hash` varchar(255),
	`password_salt` varchar(255),
	`supabase_id` varchar(64),
	`clerk_id` varchar(64),
	`unionId` varchar(255),
	`name` varchar(255),
	`avatar` text,
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	`lastSignInAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`),
	CONSTRAINT `users_supabase_id_unique` UNIQUE(`supabase_id`),
	CONSTRAINT `users_clerk_id_unique` UNIQUE(`clerk_id`),
	CONSTRAINT `users_unionId_unique` UNIQUE(`unionId`)
);
--> statement-breakpoint
CREATE INDEX `alerts_user_idx` ON `alerts` (`user_id`);--> statement-breakpoint
CREATE INDEX `type_idx` ON `alerts` (`type`);--> statement-breakpoint
CREATE INDEX `severity_idx` ON `alerts` (`severity`);--> statement-breakpoint
CREATE INDEX `alerts_created_at_idx` ON `alerts` (`created_at`);--> statement-breakpoint
CREATE INDEX `api_requests_user_idx` ON `api_requests` (`user_id`);--> statement-breakpoint
CREATE INDEX `endpoint_idx` ON `api_requests` (`endpoint`);--> statement-breakpoint
CREATE INDEX `method_idx` ON `api_requests` (`method`);--> statement-breakpoint
CREATE INDEX `status_code_idx` ON `api_requests` (`status_code`);--> statement-breakpoint
CREATE INDEX `created_at_idx` ON `api_requests` (`created_at`);--> statement-breakpoint
CREATE INDEX `endpoints_user_idx` ON `endpoints` (`user_id`);--> statement-breakpoint
CREATE INDEX `path_idx` ON `endpoints` (`path`);--> statement-breakpoint
CREATE INDEX `usage_alerts_user_idx` ON `usage_alerts` (`user_id`);--> statement-breakpoint
CREATE INDEX `usage_alerts_limit_idx` ON `usage_alerts` (`limit_id`);--> statement-breakpoint
CREATE INDEX `usage_alerts_created_at_idx` ON `usage_alerts` (`created_at`);--> statement-breakpoint
CREATE INDEX `usage_limits_user_idx` ON `usage_limits` (`user_id`);--> statement-breakpoint
CREATE INDEX `usage_limits_endpoint_idx` ON `usage_limits` (`endpoint`);--> statement-breakpoint
CREATE INDEX `users_email_idx` ON `users` (`email`);