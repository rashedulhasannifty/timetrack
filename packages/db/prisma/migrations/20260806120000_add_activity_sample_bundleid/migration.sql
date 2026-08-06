-- Add the stable macOS bundle identifier to activity samples (rename-proof app matching).
-- Nullable + additive: existing rows and the shipped client (which sends no bundleId) are
-- unaffected. `activity_samples` is monthly-partitioned; ALTER TABLE on the parent propagates the
-- column to every partition, and the partition key (timestamp) is untouched.
ALTER TABLE "activity_samples" ADD COLUMN "bundleId" TEXT;
