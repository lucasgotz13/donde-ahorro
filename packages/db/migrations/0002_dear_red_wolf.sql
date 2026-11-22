CREATE TABLE "product_promos" (
	"product_id" bigint NOT NULL,
	"branch_id" text NOT NULL,
	"slot" smallint NOT NULL,
	"price" integer NOT NULL,
	"min_quantity" smallint NOT NULL,
	"valid_from" date,
	"valid_until" date,
	"published" date NOT NULL,
	CONSTRAINT "product_promos_product_id_branch_id_slot_pk" PRIMARY KEY("product_id","branch_id","slot"),
	CONSTRAINT "product_promos_min_quantity" CHECK ("product_promos"."min_quantity" >= 1),
	CONSTRAINT "product_promos_valid_range" CHECK ("product_promos"."valid_from" is null or "product_promos"."valid_until" is null or "product_promos"."valid_until" >= "product_promos"."valid_from")
);
--> statement-breakpoint
ALTER TABLE "product_promos" ADD CONSTRAINT "product_promos_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_promos" ADD CONSTRAINT "product_promos_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_promos_branch" ON "product_promos" USING btree ("branch_id");