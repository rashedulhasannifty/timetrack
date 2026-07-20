-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'FLAGGED');

-- CreateTable
CREATE TABLE "timesheet_approvals" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "totalSeconds" INTEGER,
    "reviewerId" TEXT,
    "note" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timesheet_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "timesheet_approvals_status_idx" ON "timesheet_approvals"("status");

-- CreateIndex
CREATE UNIQUE INDEX "timesheet_approvals_userId_periodStart_key" ON "timesheet_approvals"("userId", "periodStart");

-- AddForeignKey
ALTER TABLE "timesheet_approvals" ADD CONSTRAINT "timesheet_approvals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
