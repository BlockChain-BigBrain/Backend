-- AlterTable
ALTER TABLE `Track` ADD COLUMN `isPublic` BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX `Track_isPublic_createdAt_idx` ON `Track`(`isPublic`, `createdAt`);
