CREATE TABLE `ContributionInvitation` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `trackId` INTEGER NOT NULL,
  `inviterId` INTEGER NOT NULL,
  `email` VARCHAR(191) NULL,
  `walletAddress` VARCHAR(42) NULL,
  `role` ENUM('PROMPT','EDIT','COMPOSER','VOCAL','PRODUCER','OTHER') NOT NULL,
  `percentage` DECIMAL(5,2) NOT NULL,
  `status` ENUM('PENDING','ACCEPTED','REJECTED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `acceptedAt` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `ContributionInvitation_trackId_status_idx`(`trackId`, `status`),
  INDEX `ContributionInvitation_email_status_idx`(`email`, `status`),
  INDEX `ContributionInvitation_walletAddress_status_idx`(`walletAddress`, `status`),
  CONSTRAINT `ContributionInvitation_trackId_fkey` FOREIGN KEY (`trackId`) REFERENCES `Track`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ContributionInvitation_inviterId_fkey` FOREIGN KEY (`inviterId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
