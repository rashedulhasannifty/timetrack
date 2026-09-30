-- CreateTable
CREATE TABLE "project_teams" (
    "projectId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,

    CONSTRAINT "project_teams_pkey" PRIMARY KEY ("projectId","teamId")
);

-- CreateIndex
CREATE INDEX "project_teams_teamId_idx" ON "project_teams"("teamId");

-- AddForeignKey
ALTER TABLE "project_teams" ADD CONSTRAINT "project_teams_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_teams" ADD CONSTRAINT "project_teams_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every existing project is linked to its home team.
INSERT INTO "project_teams" ("projectId", "teamId") SELECT "id", "teamId" FROM "projects";

-- AlterTable
ALTER TABLE "time_entries" ADD COLUMN "teamId" TEXT;

-- Backfill: the user's CURRENT team is the best record of history we have.
UPDATE "time_entries" te SET "teamId" = u."teamId" FROM "users" u WHERE u."id" = te."userId";

-- CreateIndex
CREATE INDEX "time_entries_projectId_teamId_idx" ON "time_entries"("projectId", "teamId");

-- Stamp the inserting user's team. BEFORE INSERT only: an UPDATE (sync heartbeat, close, edit)
-- never touches it, so moving a person never re-attributes their history. Reads the TARGET
-- user's row, so a manager filing a manual entry for an employee stamps the employee's team.
-- Invisible to Prisma's diff, like the partial indexes.
CREATE FUNCTION "time_entries_stamp_team"() RETURNS trigger AS $$
BEGIN
  IF NEW."teamId" IS NULL THEN
    SELECT "teamId" INTO NEW."teamId" FROM "users" WHERE "id" = NEW."userId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "time_entries_stamp_team"
  BEFORE INSERT ON "time_entries"
  FOR EACH ROW EXECUTE FUNCTION "time_entries_stamp_team"();
