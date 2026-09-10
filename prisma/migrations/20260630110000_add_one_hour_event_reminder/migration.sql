ALTER TABLE "Event"
ADD COLUMN "reminderOneHourSent" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Event_status_startsAt_reminderOneHourSent_idx"
ON "Event"("status", "startsAt", "reminderOneHourSent");
