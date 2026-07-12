-- CreateIndex
-- At most one running (open) time entry per user. Partial unique index; not
-- expressible in schema.prisma. time_entries is NOT partitioned, so this is safe.
CREATE UNIQUE INDEX "time_entries_one_running_per_user"
  ON "time_entries" ("userId")
  WHERE "endTime" IS NULL;
