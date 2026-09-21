CREATE TABLE `ad_creatives` (
	`id` varchar(128) NOT NULL,
	`product_id` varchar(128) NOT NULL,
	`preset_id` varchar(128),
	`suggestion_id` varchar(128),
	`preset_key` varchar(64),
	`platform` varchar(32),
	`price` varchar(64),
	`discount` varchar(64),
	`phone` varchar(64),
	`website` varchar(256),
	`cta` varchar(128),
	`logo_image_url` varchar(512),
	`image_url` varchar(512),
	`status` enum('processing','done','failed') NOT NULL DEFAULT 'processing',
	`error` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ad_creatives_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ad_presets` (
	`id` varchar(128) NOT NULL,
	`preset_key` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`group` varchar(32) NOT NULL,
	`aspect_ratio` varchar(16) NOT NULL DEFAULT '1:1',
	`prompt_modifier` text NOT NULL,
	`requires_offer` boolean DEFAULT false,
	`icon` varchar(64),
	`sort_order` int DEFAULT 0,
	`is_active` boolean DEFAULT true,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `ad_presets_id` PRIMARY KEY(`id`),
	CONSTRAINT `ad_presets_preset_key_unique` UNIQUE(`preset_key`)
);
--> statement-breakpoint
CREATE TABLE `ad_suggestions` (
	`id` varchar(128) NOT NULL,
	`product_id` varchar(128) NOT NULL,
	`title` varchar(128) NOT NULL,
	`category` varchar(32) NOT NULL,
	`aspect_ratio` varchar(16) NOT NULL DEFAULT '1:1',
	`prompt_modifier` text NOT NULL,
	`requires_offer` boolean DEFAULT false,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `ad_suggestions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `ad_creatives` ADD CONSTRAINT `ad_creatives_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ad_creatives` ADD CONSTRAINT `ad_creatives_preset_id_ad_presets_id_fk` FOREIGN KEY (`preset_id`) REFERENCES `ad_presets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ad_creatives` ADD CONSTRAINT `ad_creatives_suggestion_id_ad_suggestions_id_fk` FOREIGN KEY (`suggestion_id`) REFERENCES `ad_suggestions`(`id`) ON DELETE no action ON UPDATE no action;