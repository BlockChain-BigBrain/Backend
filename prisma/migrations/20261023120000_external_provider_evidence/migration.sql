ALTER TABLE `Verification` ADD COLUMN `evidence` JSON NULL;
ALTER TABLE `SimilarityResult` ADD COLUMN `externalTrackId` VARCHAR(191) NULL;
