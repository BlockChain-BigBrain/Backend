-- Requires MySQL 8.0.16+ for enforced CHECK constraints.
-- AlterTable
ALTER TABLE `User` ADD COLUMN `walletAddress` VARCHAR(42) NULL;

-- AlterTable
ALTER TABLE `Track` ADD COLUMN `audioCid` VARCHAR(255) NULL,
    ADD COLUMN `audioHash` VARCHAR(64) NULL,
    ADD COLUMN `blockchainTrackId` VARCHAR(78) NULL,
    ADD COLUMN `contributionsFinalizedAt` DATETIME(3) NULL,
    ADD COLUMN `duration` DECIMAL(12, 3) NULL,
    ADD COLUMN `fileSize` BIGINT UNSIGNED NULL,
    ADD COLUMN `metadataCid` VARCHAR(255) NULL,
    ADD COLUMN `registrationStatus` ENUM('NOT_REGISTERED', 'PENDING', 'REGISTERED', 'FAILED') NOT NULL DEFAULT 'NOT_REGISTERED',
    ADD COLUMN `registrationTxHash` VARCHAR(66) NULL;

-- AlterTable
ALTER TABLE `Verification` ADD COLUMN `duplicate` BOOLEAN NULL,
    ADD COLUMN `errorCode` VARCHAR(191) NULL,
    ADD COLUMN `errorMessage` TEXT NULL,
    ADD COLUMN `modelVersion` VARCHAR(191) NULL,
    ADD COLUMN `riskScore` DECIMAL(5, 4) NULL,
    ADD COLUMN `riskStatus` ENUM('PASS', 'WARN', 'HOLD') NULL,
    ADD COLUMN `source` ENUM('UNCONFIGURED', 'MOCK', 'AI') NOT NULL DEFAULT 'UNCONFIGURED',
    ADD COLUMN `verifiedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `SimilarityResult` ADD COLUMN `comparedTrackId` INTEGER NULL,
    ADD COLUMN `verificationId` INTEGER NULL;

-- AlterTable
ALTER TABLE `License` ADD COLUMN `currency` ENUM('UNKNOWN', 'KRW', 'USD', 'ETH', 'MATIC') NOT NULL DEFAULT 'UNKNOWN',
    ADD COLUMN `issuedAt` DATETIME(3) NULL,
    ADD COLUMN `licenseStatus` ENUM('PENDING_PAYMENT', 'PENDING_MINT', 'COMPLETED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING_PAYMENT',
    ADD COLUMN `licenseTermsCid` VARCHAR(255) NULL,
    ADD COLUMN `purchaseTxHash` VARCHAR(66) NULL,
    ADD COLUMN `tokenId` VARCHAR(78) NULL,
    MODIFY `price` DECIMAL(36, 18) NOT NULL;

-- AlterTable
ALTER TABLE `Transaction` ADD COLUMN `confirmedAt` DATETIME(3) NULL,
    ADD COLUMN `currency` ENUM('UNKNOWN', 'KRW', 'USD', 'ETH', 'MATIC') NOT NULL DEFAULT 'UNKNOWN',
    ADD COLUMN `failureReason` TEXT NULL,
    ADD COLUMN `paymentReference` VARCHAR(191) NULL,
    ADD COLUMN `transactionType` ENUM('LICENSE_PURCHASE', 'REVENUE_WITHDRAWAL') NOT NULL DEFAULT 'LICENSE_PURCHASE',
    MODIFY `amount` DECIMAL(36, 18) NOT NULL;

-- CreateTable
CREATE TABLE `MarketplaceListing` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `trackId` INTEGER NOT NULL,
    `sellerId` INTEGER NOT NULL,
    `price` DECIMAL(36, 18) NOT NULL,
    `currency` ENUM('UNKNOWN', 'KRW', 'USD', 'ETH', 'MATIC') NOT NULL,
    `status` ENUM('PREPARING', 'ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'PREPARING',
    `licenseType` ENUM('PERSONAL', 'COMMERCIAL') NOT NULL DEFAULT 'COMMERCIAL',
    `activeTrackId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MarketplaceListing_activeTrackId_key`(`activeTrackId`),
    INDEX `MarketplaceListing_trackId_status_idx`(`trackId`, `status`),
    INDEX `MarketplaceListing_sellerId_createdAt_idx`(`sellerId`, `createdAt`),
    INDEX `MarketplaceListing_status_currency_price_idx`(`status`, `currency`, `price`),
    INDEX `MarketplaceListing_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RevenueAllocation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `transactionId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `percentage` DECIMAL(5, 2) NOT NULL,
    `amount` DECIMAL(36, 18) NOT NULL,
    `currency` ENUM('UNKNOWN', 'KRW', 'USD', 'ETH', 'MATIC') NOT NULL,
    `confirmedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RevenueAllocation_userId_currency_confirmedAt_idx`(`userId`, `currency`, `confirmedAt`),
    UNIQUE INDEX `RevenueAllocation_transactionId_userId_key`(`transactionId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RevenueWithdrawal` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `amount` DECIMAL(36, 18) NOT NULL,
    `currency` ENUM('UNKNOWN', 'KRW', 'USD', 'ETH', 'MATIC') NOT NULL,
    `status` ENUM('PREPARING', 'PENDING', 'COMPLETED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PREPARING',
    `paymentReference` VARCHAR(191) NULL,
    `txHash` VARCHAR(66) NULL,
    `failureReason` TEXT NULL,
    `confirmedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `RevenueWithdrawal_paymentReference_key`(`paymentReference`),
    INDEX `RevenueWithdrawal_userId_currency_status_idx`(`userId`, `currency`, `status`),
    INDEX `RevenueWithdrawal_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `User_walletAddress_key` ON `User`(`walletAddress`);

-- CreateIndex
CREATE INDEX `Track_ownerId_createdAt_idx` ON `Track`(`ownerId`, `createdAt`);

-- CreateIndex
CREATE INDEX `Track_audioHash_idx` ON `Track`(`audioHash`);

-- CreateIndex
CREATE INDEX `Track_registrationStatus_idx` ON `Track`(`registrationStatus`);

-- CreateIndex
CREATE INDEX `Contribution_userId_idx` ON `Contribution`(`userId`);

-- CreateIndex
CREATE INDEX `Verification_trackId_createdAt_idx` ON `Verification`(`trackId`, `createdAt`);

-- CreateIndex
CREATE INDEX `Verification_trackId_status_idx` ON `Verification`(`trackId`, `status`);

-- CreateIndex
CREATE INDEX `SimilarityResult_verificationId_score_idx` ON `SimilarityResult`(`verificationId`, `score`);

-- CreateIndex
CREATE INDEX `SimilarityResult_comparedTrackId_idx` ON `SimilarityResult`(`comparedTrackId`);

-- CreateIndex
CREATE INDEX `License_buyerId_createdAt_idx` ON `License`(`buyerId`, `createdAt`);

-- CreateIndex
CREATE INDEX `License_trackId_licenseStatus_idx` ON `License`(`trackId`, `licenseStatus`);

-- CreateIndex
CREATE UNIQUE INDEX `Transaction_paymentReference_key` ON `Transaction`(`paymentReference`);

-- CreateIndex
CREATE INDEX `Transaction_userId_createdAt_idx` ON `Transaction`(`userId`, `createdAt`);

-- CreateIndex
CREATE INDEX `Transaction_trackId_status_idx` ON `Transaction`(`trackId`, `status`);

-- CreateIndex
CREATE INDEX `Transaction_licenseId_idx` ON `Transaction`(`licenseId`);

-- AddForeignKey
ALTER TABLE `SimilarityResult` ADD CONSTRAINT `SimilarityResult_verificationId_fkey` FOREIGN KEY (`verificationId`) REFERENCES `Verification`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SimilarityResult` ADD CONSTRAINT `SimilarityResult_comparedTrackId_fkey` FOREIGN KEY (`comparedTrackId`) REFERENCES `Track`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketplaceListing` ADD CONSTRAINT `MarketplaceListing_trackId_fkey` FOREIGN KEY (`trackId`) REFERENCES `Track`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `MarketplaceListing` ADD CONSTRAINT `MarketplaceListing_sellerId_fkey` FOREIGN KEY (`sellerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RevenueAllocation` ADD CONSTRAINT `RevenueAllocation_transactionId_fkey` FOREIGN KEY (`transactionId`) REFERENCES `Transaction`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RevenueAllocation` ADD CONSTRAINT `RevenueAllocation_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RevenueWithdrawal` ADD CONSTRAINT `RevenueWithdrawal_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prisma cannot express CHECK constraints. Keep these in future migrations.
ALTER TABLE `MarketplaceListing`
  ADD CONSTRAINT `MarketplaceListing_active_track_check` CHECK (
    (`status` = 'ACTIVE' AND `activeTrackId` IS NOT NULL AND `activeTrackId` = `trackId`)
    OR (`status` <> 'ACTIVE' AND `activeTrackId` IS NULL)
  ),
  ADD CONSTRAINT `MarketplaceListing_price_check` CHECK (`price` > 0),
  ADD CONSTRAINT `MarketplaceListing_currency_check` CHECK (`currency` <> 'UNKNOWN');
ALTER TABLE `Verification`
  ADD CONSTRAINT `Verification_risk_score_check` CHECK (`riskScore` IS NULL OR (`riskScore` >= 0 AND `riskScore` <= 1));
ALTER TABLE `RevenueAllocation`
  ADD CONSTRAINT `RevenueAllocation_percentage_check` CHECK (`percentage` > 0 AND `percentage` <= 100),
  ADD CONSTRAINT `RevenueAllocation_amount_check` CHECK (`amount` >= 0),
  ADD CONSTRAINT `RevenueAllocation_currency_check` CHECK (`currency` <> 'UNKNOWN');
ALTER TABLE `RevenueWithdrawal`
  ADD CONSTRAINT `RevenueWithdrawal_amount_check` CHECK (`amount` > 0),
  ADD CONSTRAINT `RevenueWithdrawal_currency_check` CHECK (`currency` <> 'UNKNOWN');
