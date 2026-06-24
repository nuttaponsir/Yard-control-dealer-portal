CREATE TABLE "autologic_devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price" integer DEFAULT 0 NOT NULL,
	"compatible_models" text[] DEFAULT '{}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "autologic_devices_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "claim_resolutions" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name_th" text NOT NULL,
	"refundable" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "claim_resolutions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "order_id" integer;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "resolution" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "decided_by" integer;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "decided_at" text;--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "return_id" integer;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_return_id_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."returns"("id") ON DELETE no action ON UPDATE no action;