-- Re-anchor timesheet approval periods from UTC Monday 00:00 to Asia/Dhaka Monday 00:00.
--
-- Every other week boundary in the product (the reports week, the dashboard week strip,
-- `weekStartDay` + `dayStartInstant`) is a Monday in the org time zone. `timesheet-generate`
-- anchored to UTC instead, putting the approval week 6h out of step: work done between
-- Monday 00:00 and 06:00 Dhaka landed in the PREVIOUS week's timesheet, so the total a
-- manager signed off could never be reconciled to the total the employee saw.
--
-- The zone is written literally here, NOT read from APP_TIMEZONE: a migration records what
-- was done to the data at a point in time and must keep producing the same result even if
-- the constant is changed later.
--
-- All rows are moved, including DECIDED ones, so the (userId, periodStart) unique key stays
-- one row per user-week. Without this the next cron would insert a SECOND, Dhaka-anchored row
-- for every already-decided week inside the 4-week lookback and a manager would see the same
-- week twice. `totalSeconds` is the number that was signed off and is deliberately left
-- untouched — only the window the row names moves.
--
-- The shift is a uniform -6h, so it cannot collide: two distinct UTC Mondays never map onto
-- one Dhaka Monday.

-- The 'UTC' hops are the column's storage convention (Prisma stores DateTime as `timestamp
-- without time zone` holding UTC), not a second time zone: lift to an instant, read the week
-- in Dhaka, lower back. Without them the truncation happens in the session zone and shifts
-- the row +6h instead of -6h.

UPDATE "timesheet_approvals"
SET "periodStart" = (date_trunc('week', "periodStart" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Dhaka')
                     AT TIME ZONE 'Asia/Dhaka') AT TIME ZONE 'UTC',
    "periodEnd"   = ((date_trunc('week', "periodStart" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Dhaka')
                      AT TIME ZONE 'Asia/Dhaka') AT TIME ZONE 'UTC') + interval '7 days'
WHERE "periodStart" <> ((date_trunc('week', "periodStart" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Dhaka')
                         AT TIME ZONE 'Asia/Dhaka') AT TIME ZONE 'UTC');
