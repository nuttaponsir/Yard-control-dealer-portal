CREATE TABLE "cycle_counts" (
	"id" serial PRIMARY KEY NOT NULL,
	"count_no" text NOT NULL,
	"part_id" integer NOT NULL,
	"warehouse" text NOT NULL,
	"system_qty" integer NOT NULL,
	"counted_qty" integer NOT NULL,
	"variance" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"note" text,
	"created_by" integer,
	"created_at" text NOT NULL,
	"posted_at" text,
	CONSTRAINT "cycle_counts_count_no_unique" UNIQUE("count_no")
);
--> statement-breakpoint
CREATE TABLE "purchase_order_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"purchase_order_id" integer NOT NULL,
	"part_id" integer NOT NULL,
	"qty_ordered" integer NOT NULL,
	"qty_received" integer DEFAULT 0 NOT NULL,
	"unit_cost" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"po_number" text NOT NULL,
	"supplier_id" integer NOT NULL,
	"warehouse" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"total_cost" integer DEFAULT 0 NOT NULL,
	"note" text,
	"expected_at" text,
	"created_by" integer,
	"created_at" text NOT NULL,
	"updated_at" text,
	CONSTRAINT "purchase_orders_po_number_unique" UNIQUE("po_number")
);
--> statement-breakpoint
CREATE TABLE "stock_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"transfer_no" text NOT NULL,
	"part_id" integer NOT NULL,
	"from_warehouse" text NOT NULL,
	"to_warehouse" text NOT NULL,
	"qty" integer NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"note" text,
	"created_by" integer,
	"created_at" text NOT NULL,
	"completed_at" text,
	CONSTRAINT "stock_transfers_transfer_no_unique" UNIQUE("transfer_no")
);
--> statement-breakpoint
CREATE TABLE "telematics_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"vin" text NOT NULL,
	"type" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"detail" text,
	"created_by" integer,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warranties" (
	"id" serial PRIMARY KEY NOT NULL,
	"warranty_no" text NOT NULL,
	"vin" text NOT NULL,
	"part_sku" text NOT NULL,
	"dealer_id" integer,
	"start_date" text NOT NULL,
	"months" integer NOT NULL,
	"expires_at" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"note" text,
	"created_by" integer,
	"created_at" text NOT NULL,
	CONSTRAINT "warranties_warranty_no_unique" UNIQUE("warranty_no")
);
--> statement-breakpoint
ALTER TABLE "cycle_counts" ADD CONSTRAINT "cycle_counts_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_counts" ADD CONSTRAINT "cycle_counts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telematics_events" ADD CONSTRAINT "telematics_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_dealer_id_dealers_id_fk" FOREIGN KEY ("dealer_id") REFERENCES "public"."dealers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;