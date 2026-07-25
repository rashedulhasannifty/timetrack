-- Index the range-join driver for per-project top-apps.
CREATE INDEX "time_entries_projectId_idx" ON "time_entries" ("projectId");
