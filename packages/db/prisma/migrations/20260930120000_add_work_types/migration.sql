-- AlterTable
ALTER TABLE "subprojects" ADD COLUMN     "workTypeId" TEXT;

-- CreateTable
CREATE TABLE "work_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "work_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_work_types" (
    "teamId" TEXT NOT NULL,
    "workTypeId" TEXT NOT NULL,

    CONSTRAINT "team_work_types_pkey" PRIMARY KEY ("teamId","workTypeId")
);

-- AddForeignKey
ALTER TABLE "subprojects" ADD CONSTRAINT "subprojects_workTypeId_fkey" FOREIGN KEY ("workTypeId") REFERENCES "work_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_work_types" ADD CONSTRAINT "team_work_types_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_work_types" ADD CONSTRAINT "team_work_types_workTypeId_fkey" FOREIGN KEY ("workTypeId") REFERENCES "work_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Catalog names are unique regardless of case. Expression index: not expressible in
-- schema.prisma and invisible to Prisma's diff (same as subprojects_one_default_per_project).
CREATE UNIQUE INDEX "work_types_name_ci_unique" ON "work_types" (lower("name"));

-- A project never carries the same work type twice. Partial: General and hand-made subprojects
-- (workTypeId NULL) are unconstrained. Also invisible to Prisma's diff.
CREATE UNIQUE INDEX "subprojects_one_per_work_type"
  ON "subprojects" ("projectId", "workTypeId")
  WHERE "workTypeId" IS NOT NULL;
