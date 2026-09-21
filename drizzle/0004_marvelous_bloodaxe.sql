CREATE TABLE `categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`icon` varchar(64),
	`sort_order` int DEFAULT 0,
	`is_active` boolean DEFAULT true,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `categories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `subcategories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`category_id` int NOT NULL,
	`name` varchar(100) NOT NULL,
	`sort_order` int DEFAULT 0,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `subcategories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `ad_creatives` MODIFY COLUMN `id` int AUTO_INCREMENT NOT NULL;--> statement-breakpoint
ALTER TABLE `ad_creatives` MODIFY COLUMN `product_id` int NOT NULL;--> statement-breakpoint
ALTER TABLE `ad_creatives` MODIFY COLUMN `preset_id` int;--> statement-breakpoint
ALTER TABLE `ad_creatives` MODIFY COLUMN `suggestion_id` int;--> statement-breakpoint
ALTER TABLE `ad_presets` MODIFY COLUMN `id` int AUTO_INCREMENT NOT NULL;--> statement-breakpoint
ALTER TABLE `ad_suggestions` MODIFY COLUMN `id` int AUTO_INCREMENT NOT NULL;--> statement-breakpoint
ALTER TABLE `ad_suggestions` MODIFY COLUMN `product_id` int NOT NULL;--> statement-breakpoint
ALTER TABLE `banners` MODIFY COLUMN `id` int AUTO_INCREMENT NOT NULL;--> statement-breakpoint
ALTER TABLE `banners` MODIFY COLUMN `product_id` int NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` MODIFY COLUMN `id` int AUTO_INCREMENT NOT NULL;--> statement-breakpoint
ALTER TABLE `products` MODIFY COLUMN `id` int AUTO_INCREMENT NOT NULL;--> statement-breakpoint
ALTER TABLE `products` MODIFY COLUMN `user_id` int NOT NULL;--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `id` int AUTO_INCREMENT NOT NULL;--> statement-breakpoint
ALTER TABLE `ad_presets` ADD `category_id` int;--> statement-breakpoint
ALTER TABLE `products` ADD `category_id` int;--> statement-breakpoint
ALTER TABLE `products` ADD `subcategory_id` int;--> statement-breakpoint
ALTER TABLE `subcategories` ADD CONSTRAINT `subcategories_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ad_presets` ADD CONSTRAINT `ad_presets_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_subcategory_id_subcategories_id_fk` FOREIGN KEY (`subcategory_id`) REFERENCES `subcategories`(`id`) ON DELETE no action ON UPDATE no action;