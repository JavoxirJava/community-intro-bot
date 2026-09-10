-- CreateEnum
CREATE TYPE "VacancyStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "Vacancy" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "workFormat" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "salary" TEXT,
    "requirements" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "description" TEXT,
    "status" "VacancyStatus" NOT NULL DEFAULT 'PENDING',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Vacancy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Vacancy_groupId_status_createdAt_idx" ON "Vacancy"("groupId", "status", "createdAt");
CREATE INDEX "Vacancy_creatorId_status_createdAt_idx" ON "Vacancy"("creatorId", "status", "createdAt");
CREATE INDEX "Vacancy_status_createdAt_idx" ON "Vacancy"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Vacancy" ADD CONSTRAINT "Vacancy_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Vacancy" ADD CONSTRAINT "Vacancy_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Vacancy" ADD CONSTRAINT "Vacancy_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
