-- AlterTable
-- Multi-display capture: one tick now writes one row per attached display, all sharing a
-- captureGroupId so the dashboard can render the desk as a single group.
--
-- Applied to the PARTITIONED PARENT; Postgres propagates the columns to every existing and
-- future monthly partition. All three are nullable: rows written before this migration were
-- always a single main-display capture, and readers treat a null captureGroupId as a group of
-- one rather than backfilling a synthetic id.
--
-- No new constraint or index here. The read path is already served by (userId, timestamp) --
-- a group shares one timestamp, so grouping happens on rows that index already returns
-- together. Any unique constraint on captureGroupId would have to include the partition key
-- "timestamp" to be legal on a partitioned table, and buys nothing.
ALTER TABLE "screenshots" ADD COLUMN "captureGroupId" TEXT;
ALTER TABLE "screenshots" ADD COLUMN "displayIndex" INTEGER;
ALTER TABLE "screenshots" ADD COLUMN "displayCount" INTEGER;
