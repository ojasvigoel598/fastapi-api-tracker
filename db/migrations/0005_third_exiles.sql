ALTER TABLE `users` ADD `email_verified_at` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `verification_token_hash` varchar(64);--> statement-breakpoint
ALTER TABLE `users` ADD `verification_token_expires_at` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `reset_token_hash` varchar(64);--> statement-breakpoint
ALTER TABLE `users` ADD `reset_token_expires_at` timestamp;--> statement-breakpoint
-- Accounts created before email verification existed are treated as verified:
-- they were provisioned by an admin/owner flow and cannot retroactively be
-- locked out of long-lived webhook keys.
UPDATE `users` SET `email_verified_at` = now() WHERE `email_verified_at` IS NULL;