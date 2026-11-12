CREATE TABLE "zetta"."poll_vote" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"message_id" uuid NOT NULL,
	"option_id" text NOT NULL,
	"voter" text NOT NULL,
	"voter_user_id" text,
	"voter_bot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poll_vote_voter_check" CHECK (("voter" = 'user' and "voter_user_id" is not null and "voter_bot_id" is null) or ("voter" = 'bot' and "voter_bot_id" is not null and "voter_user_id" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "poll_vote_user_unique" ON "zetta"."poll_vote" ("message_id","option_id","voter_user_id") WHERE "voter_user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "poll_vote_bot_unique" ON "zetta"."poll_vote" ("message_id","option_id","voter_bot_id") WHERE "voter_bot_id" is not null;--> statement-breakpoint
CREATE INDEX "poll_vote_voter_user_id_idx" ON "zetta"."poll_vote" ("voter_user_id");--> statement-breakpoint
CREATE INDEX "poll_vote_voter_bot_id_idx" ON "zetta"."poll_vote" ("voter_bot_id");--> statement-breakpoint
ALTER TABLE "zetta"."poll_vote" ADD CONSTRAINT "poll_vote_message_id_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "zetta"."message"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."poll_vote" ADD CONSTRAINT "poll_vote_voter_user_id_user_id_fkey" FOREIGN KEY ("voter_user_id") REFERENCES "zetta"."user"("id") ON DELETE CASCADE ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "zetta"."poll_vote" ADD CONSTRAINT "poll_vote_voter_bot_id_bot_id_fkey" FOREIGN KEY ("voter_bot_id") REFERENCES "zetta"."bot"("id") ON DELETE CASCADE ON UPDATE RESTRICT;