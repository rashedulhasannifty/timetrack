-- Slice 3b — soft-archive tasks (hidden from assignment; history preserved).
ALTER TABLE "tasks" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;
