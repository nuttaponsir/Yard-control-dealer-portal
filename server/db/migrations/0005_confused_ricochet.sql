CREATE TABLE "pick_task_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"pick_task_id" integer NOT NULL,
	"part_id" integer NOT NULL,
	"qty" integer NOT NULL,
	"location_id" integer,
	"picked_qty" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pick_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"pick_number" text NOT NULL,
	"order_id" integer NOT NULL,
	"warehouse" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_to" integer,
	"created_at" text NOT NULL,
	"updated_at" text,
	CONSTRAINT "pick_tasks_pick_number_unique" UNIQUE("pick_number")
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"part_id" integer NOT NULL,
	"warehouse" text NOT NULL,
	"location_id" integer,
	"kind" text NOT NULL,
	"qty" integer NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"note" text,
	"created_by" integer,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"warehouse" text NOT NULL,
	"code" text NOT NULL,
	"zone" text,
	"aisle" text,
	"bin" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "storage_locations_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "pick_task_items" ADD CONSTRAINT "pick_task_items_pick_task_id_pick_tasks_id_fk" FOREIGN KEY ("pick_task_id") REFERENCES "public"."pick_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_task_items" ADD CONSTRAINT "pick_task_items_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_task_items" ADD CONSTRAINT "pick_task_items_location_id_storage_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."storage_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_tasks" ADD CONSTRAINT "pick_tasks_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_tasks" ADD CONSTRAINT "pick_tasks_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_location_id_storage_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."storage_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;