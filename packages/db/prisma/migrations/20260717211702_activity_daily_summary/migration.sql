-- CreateTable
CREATE TABLE "activity_daily_summaries" (
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "avgActivityPct" INTEGER NOT NULL,
    "activeMinutes" INTEGER NOT NULL,
    "byApp" JSONB NOT NULL,
    "byCategory" JSONB NOT NULL,

    CONSTRAINT "activity_daily_summaries_pkey" PRIMARY KEY ("userId","day")
);
