-- CreateTable
CREATE TABLE "subprojects" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "subprojects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subprojects_projectId_archived_idx" ON "subprojects"("projectId", "archived");

-- AddForeignKey
ALTER TABLE "subprojects" ADD CONSTRAINT "subprojects_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Exactly one default subproject per project. Partial unique index; not expressible in
-- schema.prisma and invisible to Prisma's diff (same as time_entries_one_running_per_user).
CREATE UNIQUE INDEX "subprojects_one_default_per_project"
  ON "subprojects" ("projectId")
  WHERE "isDefault";

-- Backfill: one "General" default per existing project. Ids are UUIDv7 like @default(uuid(7)).
INSERT INTO "subprojects" ("id", "projectId", "name", "archived", "isDefault")
SELECT uuidv7()::text, p."id", 'General', false, true
FROM "projects" p;

-- AlterTable: every task moves into its project's default, then the column becomes required.
ALTER TABLE "tasks" ADD COLUMN "subprojectId" TEXT;

UPDATE "tasks" t
SET "subprojectId" = s."id"
FROM "subprojects" s
WHERE s."projectId" = t."projectId" AND s."isDefault";

ALTER TABLE "tasks" ALTER COLUMN "subprojectId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "tasks_subprojectId_idx" ON "tasks"("subprojectId");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_subprojectId_fkey" FOREIGN KEY ("subprojectId") REFERENCES "subprojects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: nullable, no FK, no CHECK (see schema.prisma). Backfill is re-runnable
-- (WHERE "subprojectId" IS NULL) so rows written by old code during a rollback can be repaired.
ALTER TABLE "time_entries" ADD COLUMN "subprojectId" TEXT;

-- Entries with a task of the SAME project take the task's subproject...
UPDATE "time_entries" te
SET "subprojectId" = t."subprojectId"
FROM "tasks" t
WHERE te."subprojectId" IS NULL
  AND te."taskId" = t."id"
  AND te."projectId" = t."projectId";

-- ...every other entry of an existing project takes that project's default.
UPDATE "time_entries" te
SET "subprojectId" = s."id"
FROM "subprojects" s
WHERE te."subprojectId" IS NULL
  AND s."projectId" = te."projectId"
  AND s."isDefault";

-- CreateIndex
CREATE INDEX "time_entries_subprojectId_idx" ON "time_entries"("subprojectId");
