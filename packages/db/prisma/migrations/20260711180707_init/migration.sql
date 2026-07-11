-- CreateEnum
CREATE TYPE "Role" AS ENUM ('EMPLOYEE', 'MANAGER', 'ADMIN');

-- CreateEnum
CREATE TYPE "EntrySource" AS ENUM ('MANUAL', 'AUTO');

-- CreateEnum
CREATE TYPE "Category" AS ENUM ('PRODUCTIVE', 'UNPRODUCTIVE', 'NEUTRAL');

-- CreateEnum
CREATE TYPE "ShotStatus" AS ENUM ('PENDING', 'READY', 'REDACTED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'EMPLOYEE',
    "passwordHash" TEXT NOT NULL,
    "monitoringAckAt" TIMESTAMP(3),
    "teamId" TEXT NOT NULL,
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_entries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "taskId" TEXT,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "source" "EntrySource" NOT NULL,
    "note" TEXT,
    "editedById" TEXT,
    "editedAt" TIMESTAMP(3),

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_samples" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "appName" TEXT NOT NULL,
    "windowTitle" TEXT,
    "activityPct" INTEGER NOT NULL,
    "category" "Category" NOT NULL DEFAULT 'NEUTRAL',

    CONSTRAINT "activity_samples_pkey" PRIMARY KEY ("id","timestamp")
) PARTITION BY RANGE ("timestamp");

-- CreateTable
CREATE TABLE "screenshots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "storageKey" TEXT NOT NULL,
    "thumbnailKey" TEXT,
    "blurred" BOOLEAN NOT NULL DEFAULT false,
    "status" "ShotStatus" NOT NULL DEFAULT 'PENDING',
    "redactedReason" TEXT,

    CONSTRAINT "screenshots_pkey" PRIMARY KEY ("id","timestamp")
) PARTITION BY RANGE ("timestamp");

-- CreateTable
CREATE TABLE "idle_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "resolvedAction" TEXT NOT NULL,

    CONSTRAINT "idle_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "diff" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_teamId_deactivatedAt_idx" ON "users"("teamId", "deactivatedAt");

-- CreateIndex
CREATE INDEX "projects_teamId_archived_idx" ON "projects"("teamId", "archived");

-- CreateIndex
CREATE INDEX "time_entries_userId_startTime_idx" ON "time_entries"("userId", "startTime");

-- CreateIndex
CREATE INDEX "activity_samples_userId_timestamp_idx" ON "activity_samples"("userId", "timestamp");

-- CreateIndex
CREATE INDEX "screenshots_userId_timestamp_idx" ON "screenshots"("userId", "timestamp");

-- CreateIndex
CREATE INDEX "idle_events_userId_startTime_idx" ON "idle_events"("userId", "startTime");

-- CreateIndex
CREATE INDEX "audit_log_targetType_targetId_idx" ON "audit_log"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Monthly RANGE partitions (PRD §7.3). The two high-volume tables above are
-- declared PARTITION BY RANGE ("timestamp"); retention (PRD §10) then becomes a
-- DROP PARTITION instead of a mass DELETE — a 200ms job, not a vacuum storm.
--
-- Indexes declared on the partitioned parents propagate to every partition,
-- including these. The worker's partition-provision job pre-creates the NEXT
-- month's partition; if it ever fails, inserts into a missing range fail — alert
-- on it. These initial partitions give ~6 months of runway from first boot.
-- ============================================================================

-- CreatePartitions: activity_samples
CREATE TABLE "activity_samples_2026_07" PARTITION OF "activity_samples" FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE "activity_samples_2026_08" PARTITION OF "activity_samples" FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE "activity_samples_2026_09" PARTITION OF "activity_samples" FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE "activity_samples_2026_10" PARTITION OF "activity_samples" FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE "activity_samples_2026_11" PARTITION OF "activity_samples" FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE "activity_samples_2026_12" PARTITION OF "activity_samples" FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

-- CreatePartitions: screenshots
CREATE TABLE "screenshots_2026_07" PARTITION OF "screenshots" FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE "screenshots_2026_08" PARTITION OF "screenshots" FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE "screenshots_2026_09" PARTITION OF "screenshots" FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE "screenshots_2026_10" PARTITION OF "screenshots" FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE "screenshots_2026_11" PARTITION OF "screenshots" FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE "screenshots_2026_12" PARTITION OF "screenshots" FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
