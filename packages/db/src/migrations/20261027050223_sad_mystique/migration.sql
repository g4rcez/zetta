ALTER TABLE "attachment" ADD COLUMN "path" text;--> statement-breakpoint
ALTER TABLE "attachment" ALTER COLUMN "content" SET DEFAULT '';