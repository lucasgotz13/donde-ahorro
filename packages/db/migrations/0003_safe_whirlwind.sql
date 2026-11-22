ALTER TABLE "branches" ADD COLUMN "geo_lat" double precision;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "geo_lng" double precision;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "geocoded_address" text;