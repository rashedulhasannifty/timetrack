-- The invitee now supplies their own name on the accept form, so an invite no longer
-- carries one. Made nullable rather than dropped: invites already in flight keep the
-- name an admin typed for them, and nothing reads the column any more.
ALTER TABLE "invites" ALTER COLUMN "name" DROP NOT NULL;
