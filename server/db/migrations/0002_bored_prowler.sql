CREATE TABLE "issues" (
	"id" serial PRIMARY KEY NOT NULL,
	"issue_number" text NOT NULL,
	"title" text NOT NULL,
	"module" text,
	"page" text,
	"action" text,
	"severity" text DEFAULT 'error' NOT NULL,
	"source" text NOT NULL,
	"message" text NOT NULL,
	"stack" text,
	"detail" text,
	"screenshot" text,
	"user_id" integer,
	"user_email" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text,
	CONSTRAINT "issues_issue_number_unique" UNIQUE("issue_number")
);
--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;