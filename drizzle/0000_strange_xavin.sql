CREATE TABLE `banners` (
	`id` varchar(191) NOT NULL,
	`product_id` varchar(191) NOT NULL,
	`day` int NOT NULL,
	`theme` varchar(100),
	`image_url` varchar(500) NOT NULL,
	`caption` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `banners_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`id` varchar(191) NOT NULL,
	`name` varchar(100) NOT NULL,
	`price` int NOT NULL,
	`posters` int NOT NULL,
	`features` text,
	CONSTRAINT `plans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` varchar(191) NOT NULL,
	`user_id` varchar(191) NOT NULL,
	`original_image_url` varchar(500) NOT NULL,
	`clean_image_url` varchar(500),
	`brand` varchar(191),
	`company_name` varchar(191),
	`title` varchar(255),
	`description` text,
	`price` varchar(100),
	`category` varchar(100),
	`features` text,
	`meta_description` text,
	`keywords` text,
	`hashtags` text,
	`status` enum('processing','done','failed') NOT NULL DEFAULT 'processing',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `products_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(191) NOT NULL,
	`name` varchar(191) NOT NULL,
	`mobile` varchar(20) NOT NULL,
	`email` varchar(191),
	`password` varchar(255) NOT NULL,
	`plan` varchar(50) NOT NULL DEFAULT 'free',
	`credits` int NOT NULL DEFAULT 2,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_mobile_unique` UNIQUE(`mobile`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
