CREATE TABLE "vin_accessories" (
	"id" serial PRIMARY KEY NOT NULL,
	"vin" text NOT NULL,
	"accessory_id" integer NOT NULL,
	"installed_at" text NOT NULL,
	"install_center" text,
	"warranty_months" integer DEFAULT 0 NOT NULL,
	"note" text,
	"installed_by" integer,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vin_accessories" ADD CONSTRAINT "vin_accessories_accessory_id_autologic_devices_id_fk" FOREIGN KEY ("accessory_id") REFERENCES "public"."autologic_devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vin_accessories" ADD CONSTRAINT "vin_accessories_installed_by_users_id_fk" FOREIGN KEY ("installed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;