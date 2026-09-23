CREATE TABLE `banner_publications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`banner_id` int NOT NULL,
	`user_id` int NOT NULL,
	`platform` varchar(40) NOT NULL,
	`external_id` varchar(500) NOT NULL,
	`permalink` varchar(1000),
	`published_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `banner_publications_id` PRIMARY KEY(`id`),
	CONSTRAINT `banner_publications_banner_id_fk` FOREIGN KEY (`banner_id`) REFERENCES `banners`(`id`) ON DELETE cascade,
	CONSTRAINT `banner_publications_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade,
	INDEX `idx_banner_publications_user_banner` (`user_id`,`banner_id`)
);
