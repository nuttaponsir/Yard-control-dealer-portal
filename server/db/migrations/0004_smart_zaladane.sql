CREATE TABLE "dealer_addresses" (
	"id" serial PRIMARY KEY NOT NULL,
	"dealer_id" integer NOT NULL,
	"label" text NOT NULL,
	"kind" text DEFAULT 'both' NOT NULL,
	"line1" text NOT NULL,
	"sub_district" text,
	"district" text,
	"province" text NOT NULL,
	"postal_code" text,
	"country" text DEFAULT 'TH' NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"contact_name" text,
	"contact_phone" text,
	"is_default_billing" boolean DEFAULT false NOT NULL,
	"is_default_shipping" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ship_to_address_id" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "bill_to_address_id" integer;--> statement-breakpoint
ALTER TABLE "dealer_addresses" ADD CONSTRAINT "dealer_addresses_dealer_id_dealers_id_fk" FOREIGN KEY ("dealer_id") REFERENCES "public"."dealers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_ship_to_address_id_dealer_addresses_id_fk" FOREIGN KEY ("ship_to_address_id") REFERENCES "public"."dealer_addresses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_bill_to_address_id_dealer_addresses_id_fk" FOREIGN KEY ("bill_to_address_id") REFERENCES "public"."dealer_addresses"("id") ON DELETE no action ON UPDATE no action;