-- Slice 3a — per-project color (nullable; null → dashboard-derived fallback color).
ALTER TABLE "projects" ADD COLUMN "color" TEXT;
