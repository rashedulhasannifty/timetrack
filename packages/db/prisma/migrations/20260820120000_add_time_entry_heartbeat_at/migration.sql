-- AlterTable
-- Server-stamped liveness marker for open (endTime IS NULL) entries. Nullable: existing rows
-- have no heartbeat, and readers fall back to "startTime" for those.
ALTER TABLE "time_entries" ADD COLUMN "heartbeatAt" TIMESTAMP(3);
