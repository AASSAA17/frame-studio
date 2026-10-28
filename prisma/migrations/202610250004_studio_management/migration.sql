-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "creationKey" TEXT,
ADD COLUMN     "creationPayloadHash" TEXT,
ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'website',
ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "DecorVersion" ADD COLUMN     "archivedAt" TIMESTAMPTZ(3),
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Equipment" ADD COLUMN     "archivedAt" TIMESTAMPTZ(3),
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "archivedAt" TIMESTAMPTZ(3),
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Resource" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "ResourceClosure" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "ResourceUnit" ADD COLUMN     "maintenanceNote" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "retiredAt" TIMESTAMPTZ(3),
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "archivedAt" TIMESTAMPTZ(3),
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "archivedAt" TIMESTAMPTZ(3),
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Specialist" ADD COLUMN     "archivedAt" TIMESTAMPTZ(3),
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "StudioSettings" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "ResourceScheduleException" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "openHour" INTEGER,
    "closeHour" INTEGER,
    "revision" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ResourceScheduleException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "normalizedPhone" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "archivedAt" TIMESTAMPTZ(3),
    "userId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResourceScheduleException_resourceId_date_key" ON "ResourceScheduleException"("resourceId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_userId_key" ON "Customer"("userId");

-- CreateIndex
CREATE INDEX "Customer_name_idx" ON "Customer"("name");

-- CreateIndex
CREATE INDEX "Customer_email_idx" ON "Customer"("email");

-- CreateIndex
CREATE INDEX "Customer_normalizedPhone_idx" ON "Customer"("normalizedPhone");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_creationKey_key" ON "Booking"("creationKey");

-- CreateIndex
CREATE INDEX "Booking_customerId_startAt_idx" ON "Booking"("customerId", "startAt");

-- AddForeignKey
ALTER TABLE "ResourceScheduleException" ADD CONSTRAINT "ResourceScheduleException_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve account identity; contacts alone never link a CRM customer to a login.
INSERT INTO "Customer" ("id", "name", "email", "userId", "createdAt", "updatedAt")
SELECT 'account-' || "id", "name", "email", "id", "createdAt", CURRENT_TIMESTAMP
FROM "User" WHERE "role" = 'CLIENT' OR EXISTS (SELECT 1 FROM "Booking" WHERE "Booking"."userId" = "User"."id");
UPDATE "Booking" SET "customerId" = 'account-' || "userId", "createdById" = "userId" WHERE "userId" IS NOT NULL;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_has_customer_identity" CHECK ("userId" IS NOT NULL OR "customerId" IS NOT NULL);
ALTER TABLE "ResourceScheduleException" ADD CONSTRAINT "ResourceScheduleException_valid_hours" CHECK (
  "date" ~ '^\d{4}-\d{2}-\d{2}$' AND ("closed" OR ("openHour" IS NOT NULL AND "closeHour" IS NOT NULL))
  AND ("openHour" IS NULL OR "openHour" BETWEEN 0 AND 23) AND ("closeHour" IS NULL OR "closeHour" BETWEEN 0 AND 24)
);
ALTER TABLE "ResourceUnit" ADD CONSTRAINT "ResourceUnit_retired_inactive" CHECK ("retiredAt" IS NULL OR "active" = false);
