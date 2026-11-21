CREATE TABLE "eligibility_conditions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "promotions" ADD COLUMN "conditions" text[] DEFAULT '{}' NOT NULL;