CREATE TYPE "public"."cap_period" AS ENUM('transaction', 'day', 'week', 'month');--> statement-breakpoint
CREATE TYPE "public"."ingest_status" AS ENUM('running', 'succeeded', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."promotion_channel" AS ENUM('online', 'in-store', 'both');--> statement-breakpoint
CREATE TYPE "public"."promotion_kind" AS ENUM('discount', 'refund');--> statement-breakpoint
CREATE TABLE "branches" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" text NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"lat" double precision,
	"lng" double precision
);
--> statement-breakpoint
CREATE TABLE "chains" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sepa_comercio_id" integer NOT NULL,
	"sepa_bandera_id" integer NOT NULL,
	CONSTRAINT "chains_sepa" UNIQUE("sepa_comercio_id","sepa_bandera_id")
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_aliases" (
	"source" text NOT NULL,
	"raw" text NOT NULL,
	"entity_id" text NOT NULL,
	CONSTRAINT "entity_aliases_source_raw_pk" PRIMARY KEY("source","raw")
);
--> statement-breakpoint
CREATE TABLE "ingest_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ingest_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"source" text NOT NULL,
	"status" "ingest_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"source_last_modified" timestamp with time zone,
	"message" text,
	"stats" jsonb
);
--> statement-breakpoint
CREATE TABLE "payment_media" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_medium_aliases" (
	"source" text NOT NULL,
	"raw" text NOT NULL,
	"payment_medium_id" text NOT NULL,
	CONSTRAINT "payment_medium_aliases_source_raw_pk" PRIMARY KEY("source","raw")
);
--> statement-breakpoint
CREATE TABLE "price_periods" (
	"product_id" bigint NOT NULL,
	"branch_id" text NOT NULL,
	"price" integer NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"last_seen" date NOT NULL,
	CONSTRAINT "price_periods_product_id_branch_id_valid_from_pk" PRIMARY KEY("product_id","branch_id","valid_from"),
	CONSTRAINT "price_periods_valid_range" CHECK ("price_periods"."valid_to" is null or "price_periods"."valid_to" > "price_periods"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "products_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"ean" text,
	"chain_id" text,
	"chain_product_code" text,
	"description" text NOT NULL,
	"brand" text,
	"presentation" text,
	CONSTRAINT "products_ean" UNIQUE("ean"),
	CONSTRAINT "products_chain_code" UNIQUE("chain_id","chain_product_code"),
	CONSTRAINT "products_identity" CHECK ("products"."ean" is not null or ("products"."chain_id" is not null and "products"."chain_product_code" is not null))
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" text NOT NULL,
	"kind" "promotion_kind" NOT NULL,
	"percent" numeric(5, 2) NOT NULL,
	"entity_id" text,
	"payment_medium_id" text,
	"weekdays" smallint[] DEFAULT '{}' NOT NULL,
	"cap_amount" integer,
	"cap_period" "cap_period",
	"cap_unknown" boolean DEFAULT false NOT NULL,
	"channel" "promotion_channel" NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date NOT NULL,
	"legal_text" text DEFAULT '' NOT NULL,
	"stackable" boolean,
	"scraped_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotions_cap" CHECK (("promotions"."cap_amount" is null) = ("promotions"."cap_period" is null) and not ("promotions"."cap_unknown" and "promotions"."cap_amount" is not null)),
	CONSTRAINT "promotions_percent" CHECK ("promotions"."percent" > 0 and "promotions"."percent" <= 100),
	CONSTRAINT "promotions_valid_range" CHECK ("promotions"."valid_to" >= "promotions"."valid_from")
);
--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_aliases" ADD CONSTRAINT "entity_aliases_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_medium_aliases" ADD CONSTRAINT "payment_medium_aliases_payment_medium_id_payment_media_id_fk" FOREIGN KEY ("payment_medium_id") REFERENCES "public"."payment_media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_periods" ADD CONSTRAINT "price_periods_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_periods" ADD CONSTRAINT "price_periods_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_payment_medium_id_payment_media_id_fk" FOREIGN KEY ("payment_medium_id") REFERENCES "public"."payment_media"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "price_periods_one_open" ON "price_periods" USING btree ("product_id","branch_id") WHERE "price_periods"."valid_to" is null;