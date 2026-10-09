CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_unique` ON `categories` ("name" COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`wallet_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`description` text NOT NULL,
	`date` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`recurring_id` integer,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`recurring_id`) REFERENCES `recurring`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "expenses_amount_check" CHECK("expenses"."amount_cents" > 0 AND "expenses"."amount_cents" <= 1000000000000)
);
--> statement-breakpoint
CREATE INDEX `expenses_date_idx` ON `expenses` ("date" desc,"id" desc);--> statement-breakpoint
CREATE INDEX `expenses_wallet_idx` ON `expenses` (`wallet_id`);--> statement-breakpoint
CREATE TABLE `incomes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`wallet_id` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`source` text NOT NULL,
	`description` text NOT NULL,
	`date` text NOT NULL,
	`recurring_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`recurring_id`) REFERENCES `recurring`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "incomes_amount_check" CHECK("incomes"."amount_cents" > 0 AND "incomes"."amount_cents" <= 1000000000000)
);
--> statement-breakpoint
CREATE INDEX `incomes_date_idx` ON `incomes` ("date" desc,"id" desc);--> statement-breakpoint
CREATE INDEX `incomes_wallet_idx` ON `incomes` (`wallet_id`);--> statement-breakpoint
CREATE TABLE `recurring` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`wallet_id` integer NOT NULL,
	`category_id` integer,
	`source` text,
	`amount_cents` integer NOT NULL,
	`description` text NOT NULL,
	`start_date` text NOT NULL,
	`frequency` text NOT NULL,
	`end_date` text,
	`next_index` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "recurring_kind_check" CHECK("recurring"."kind" IN ('income','expense')),
	CONSTRAINT "recurring_amount_check" CHECK("recurring"."amount_cents" > 0 AND "recurring"."amount_cents" <= 1000000000000),
	CONSTRAINT "recurring_frequency_check" CHECK("recurring"."frequency" IN ('daily','weekly','monthly','yearly')),
	CONSTRAINT "recurring_index_check" CHECK("recurring"."next_index" >= 0),
	CONSTRAINT "recurring_enabled_check" CHECK("recurring"."enabled" IN (0,1)),
	CONSTRAINT "recurring_source_check" CHECK(("recurring"."kind"='income' AND "recurring"."source" IS NOT NULL AND "recurring"."category_id" IS NULL) OR ("recurring"."kind"='expense' AND "recurring"."category_id" IS NOT NULL AND "recurring"."source" IS NULL))
);
--> statement-breakpoint
CREATE TABLE `recurring_occurrences` (
	`recurring_id` integer NOT NULL,
	`date` text NOT NULL,
	`status` text NOT NULL,
	PRIMARY KEY(`recurring_id`, `date`),
	FOREIGN KEY (`recurring_id`) REFERENCES `recurring`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "recurring_occurrences_status_check" CHECK("recurring_occurrences"."status" IN ('posted','skipped'))
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wallets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`opening_cents` integer NOT NULL,
	CONSTRAINT "wallets_opening_check" CHECK("wallets"."opening_cents" >= 0 AND "wallets"."opening_cents" <= 1000000000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wallets_name_unique` ON `wallets` ("name" COLLATE NOCASE);