ALTER TABLE "admin_users" ADD COLUMN "passwordVersion" INTEGER NOT NULL DEFAULT 0;
INSERT INTO "system_configs" ("key", "value", "updatedAt")
SELECT 'admin-initialized', 'true'::jsonb, CURRENT_TIMESTAMP WHERE EXISTS (SELECT 1 FROM "admin_users")
ON CONFLICT ("key") DO NOTHING;
