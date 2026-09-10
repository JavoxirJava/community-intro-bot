ALTER TABLE "Event"
ADD COLUMN "reminderStartedSent" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Event_status_startsAt_reminderStartedSent_idx"
ON "Event"("status", "startsAt", "reminderStartedSent");
