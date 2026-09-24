-- CreateTable
-- One row per (user, platform): the app version that user last signed in or refreshed from.
-- No backfill: which version an app ran before it started reporting is not knowable.
CREATE TABLE "client_installs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "version" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_installs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_installs_userId_platform_key" ON "client_installs"("userId", "platform");

-- AddForeignKey
ALTER TABLE "client_installs" ADD CONSTRAINT "client_installs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
