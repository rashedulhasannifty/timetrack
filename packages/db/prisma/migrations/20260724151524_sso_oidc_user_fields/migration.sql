-- PRD §6.8 (slice 4.4) — SSO (OIDC) user fields.

-- SSO-only users have no password.
ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- The OIDC provider + subject an SSO user is linked to (null for password-only users).
ALTER TABLE "users" ADD COLUMN "ssoProvider" TEXT;
ALTER TABLE "users" ADD COLUMN "ssoSubject" TEXT;

-- Composite unique. Postgres treats any-NULL rows as distinct, so existing password
-- users at (NULL, NULL) coexist without conflict.
CREATE UNIQUE INDEX "users_ssoProvider_ssoSubject_key" ON "users"("ssoProvider", "ssoSubject");
