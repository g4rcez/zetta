CREATE TABLE "bot_database" (
	"bot_id" uuid PRIMARY KEY,
	"schema_name" text NOT NULL UNIQUE,
	"role_name" text NOT NULL UNIQUE,
	"access" boolean DEFAULT true NOT NULL,
	"templates" jsonb DEFAULT '[]' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reset_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "bot" ADD COLUMN "slug" text;--> statement-breakpoint
-- Backfill: same rules as toSlug() in apps/server/src/modules/bot-database/naming.ts (accents folded, camelCase split, trailing "bot"
-- dropped, "bot-" prefix for digits/pg-, 40 chars max). Chiefs are named after their owner. Collisions get -2, -3... in creation order.
DO $$
DECLARE r record; base text; cand text; n int;
BEGIN
  FOR r IN SELECT b.id, CASE WHEN b.kind = 'chief' THEN coalesce(u.name, '') || ' chief' ELSE b.name END AS src
    FROM "bot" b LEFT JOIN "user" u ON u.id = b.owner_user_id ORDER BY b.created_at, b.id
  LOOP
    base := translate(r.src, 'ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñÝýÿ', 'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNnYyy');
    base := regexp_replace(base, '[''’]', '', 'g');
    base := lower(regexp_replace(regexp_replace(base, '([a-z0-9])([A-Z])', '\1-\2', 'g'), '([A-Z])([A-Z][a-z])', '\1-\2', 'g'));
    base := trim(both '-' from regexp_replace(base, '[^a-z0-9]+', '-', 'g'));
    IF base ~ '.-bot$' THEN base := left(base, -4); END IF;
    IF base = '' THEN base := 'bot'; ELSIF base ~ '^[0-9]' OR base ~ '^pg-' OR base = 'pg' THEN base := 'bot-' || base; END IF;
    base := trim(both '-' from left(base, 40));
    cand := base; n := 1;
    WHILE EXISTS (SELECT 1 FROM "bot" WHERE slug = cand) LOOP n := n + 1; cand := base || '-' || n; END LOOP;
    UPDATE "bot" SET slug = cand WHERE id = r.id;
  END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "bot" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "bot_slug_key" ON "bot" ("slug");--> statement-breakpoint
ALTER TABLE "bot_database" ADD CONSTRAINT "bot_database_bot_id_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;--> statement-breakpoint
ALTER TABLE "bot" ADD CONSTRAINT "bot_slug_check" CHECK ("slug" ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and length("slug") <= 48 and "slug" !~ '^pg-');--> statement-breakpoint
-- Bot roles (one LOGIN role per bot, see modules/bot-database) must reach nothing but their own schema. Everything the app owns stays
-- with the app's role; PUBLIC (every role, bots included) loses its default rights on the public schema, its functions and the database.
REVOKE ALL ON SCHEMA public FROM PUBLIC;--> statement-breakpoint
GRANT USAGE, CREATE ON SCHEMA public TO CURRENT_USER;--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;--> statement-breakpoint
DO $$ BEGIN EXECUTE format('REVOKE CREATE, TEMPORARY ON DATABASE %I FROM PUBLIC', current_database()); END $$;