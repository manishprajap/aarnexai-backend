CREATE TABLE `social_accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`provider` varchar(40) NOT NULL,
	`provider_account_id` varchar(160),
	`account_name` varchar(255),
	`access_token` text,
	`refresh_token` text,
	`expires_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `social_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `social_accounts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE cascade,
	CONSTRAINT `uq_social_accounts_user_provider` UNIQUE(`user_id`,`provider`),
	INDEX `idx_social_accounts_user_id` (`user_id`)
);