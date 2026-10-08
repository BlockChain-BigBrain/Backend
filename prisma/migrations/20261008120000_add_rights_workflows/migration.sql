-- AlterTable
ALTER TABLE `License` ADD COLUMN `source` ENUM('UNCONFIGURED', 'MOCK', 'REAL') NOT NULL DEFAULT 'UNCONFIGURED';

-- AlterTable
ALTER TABLE `Transaction` ADD COLUMN `purchaseRequestId` INTEGER NULL,
    ADD COLUMN `source` ENUM('UNCONFIGURED', 'MOCK', 'REAL') NOT NULL DEFAULT 'UNCONFIGURED';

-- CreateTable
CREATE TABLE `MetadataSnapshot` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `trackId` INTEGER NOT NULL,
    `version` INTEGER NOT NULL,
    `hash` VARCHAR(64) NOT NULL,
    `document` JSON NOT NULL,
    `status` ENUM('PREPARED', 'UPLOADED', 'FAILED') NOT NULL DEFAULT 'PREPARED',
    `metadataCid` VARCHAR(255) NULL,
    `audioCid` VARCHAR(255) NULL,
    `errorCode` VARCHAR(191) NULL,
    `errorMessage` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MetadataSnapshot_trackId_hash_idx`(`trackId`, `hash`),
    UNIQUE INDEX `MetadataSnapshot_trackId_version_key`(`trackId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RegistrationRequest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `trackId` INTEGER NOT NULL,
    `metadataSnapshotId` INTEGER NULL,
    `nonce` VARCHAR(78) NOT NULL,
    `deadline` DATETIME(3) NOT NULL,
    `chainId` VARCHAR(78) NOT NULL,
    `contractAddress` VARCHAR(42) NULL,
    `status` ENUM('NOT_REGISTERED', 'PENDING', 'REGISTERED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `source` ENUM('UNCONFIGURED', 'MOCK', 'REAL') NOT NULL DEFAULT 'UNCONFIGURED',
    `typedData` JSON NULL,
    `signature` VARCHAR(132) NULL,
    `txHash` VARCHAR(66) NULL,
    `blockchainTrackId` VARCHAR(78) NULL,
    `errorCode` VARCHAR(191) NULL,
    `errorMessage` TEXT NULL,
    `confirmedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `RegistrationRequest_nonce_key`(`nonce`),
    INDEX `RegistrationRequest_trackId_status_idx`(`trackId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PurchaseRequest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `trackId` INTEGER NOT NULL,
    `buyerId` INTEGER NOT NULL,
    `listingId` INTEGER NOT NULL,
    `licenseId` INTEGER NULL,
    `licenseType` ENUM('PERSONAL', 'COMMERCIAL') NOT NULL,
    `price` DECIMAL(36, 18) NOT NULL,
    `currency` ENUM('UNKNOWN', 'KRW', 'USD', 'ETH', 'MATIC') NOT NULL,
    `status` ENUM('PENDING_PAYMENT', 'PENDING_MINT', 'COMPLETED', 'SIMULATED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING_PAYMENT',
    `source` ENUM('UNCONFIGURED', 'MOCK', 'REAL') NOT NULL DEFAULT 'UNCONFIGURED',
    `preparation` BOOLEAN NOT NULL DEFAULT false,
    `idempotencyKey` VARCHAR(100) NOT NULL,
    `activeBuyerTrackType` VARCHAR(100) NULL,
    `contributorSnapshot` JSON NOT NULL,
    `failureReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `confirmedAt` DATETIME(3) NULL,

    UNIQUE INDEX `PurchaseRequest_licenseId_key`(`licenseId`),
    UNIQUE INDEX `PurchaseRequest_activeBuyerTrackType_key`(`activeBuyerTrackType`),
    INDEX `PurchaseRequest_buyerId_createdAt_idx`(`buyerId`, `createdAt`),
    UNIQUE INDEX `PurchaseRequest_buyerId_idempotencyKey_key`(`buyerId`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WalletChallenge` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `walletAddress` VARCHAR(42) NOT NULL,
    `nonce` VARCHAR(64) NOT NULL,
    `message` TEXT NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,

    UNIQUE INDEX `WalletChallenge_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `Transaction_purchaseRequestId_key` ON `Transaction`(`purchaseRequestId`);

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_purchaseRequestId_fkey` FOREIGN KEY (`purchaseRequestId`) REFERENCES `PurchaseRequest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MetadataSnapshot` ADD CONSTRAINT `MetadataSnapshot_trackId_fkey` FOREIGN KEY (`trackId`) REFERENCES `Track`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RegistrationRequest` ADD CONSTRAINT `RegistrationRequest_trackId_fkey` FOREIGN KEY (`trackId`) REFERENCES `Track`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RegistrationRequest` ADD CONSTRAINT `RegistrationRequest_metadataSnapshotId_fkey` FOREIGN KEY (`metadataSnapshotId`) REFERENCES `MetadataSnapshot`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseRequest` ADD CONSTRAINT `PurchaseRequest_trackId_fkey` FOREIGN KEY (`trackId`) REFERENCES `Track`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseRequest` ADD CONSTRAINT `PurchaseRequest_buyerId_fkey` FOREIGN KEY (`buyerId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseRequest` ADD CONSTRAINT `PurchaseRequest_listingId_fkey` FOREIGN KEY (`listingId`) REFERENCES `MarketplaceListing`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseRequest` ADD CONSTRAINT `PurchaseRequest_licenseId_fkey` FOREIGN KEY (`licenseId`) REFERENCES `License`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WalletChallenge` ADD CONSTRAINT `WalletChallenge_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `PurchaseRequest`
  ADD CONSTRAINT `PurchaseRequest_price_check` CHECK (`price` > 0),
  ADD CONSTRAINT `PurchaseRequest_currency_check` CHECK (`currency` <> 'UNKNOWN');
ALTER TABLE `MetadataSnapshot`
  ADD CONSTRAINT `MetadataSnapshot_version_check` CHECK (`version` > 0);
