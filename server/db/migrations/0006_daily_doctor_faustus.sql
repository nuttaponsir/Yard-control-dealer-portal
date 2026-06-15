ALTER TABLE "pick_tasks" DROP CONSTRAINT "pick_tasks_assigned_to_users_id_fk";
--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "pick_tasks" ADD CONSTRAINT "pick_tasks_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;