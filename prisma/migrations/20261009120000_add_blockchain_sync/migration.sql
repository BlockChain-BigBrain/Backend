-- AlterTable
ALTER TABLE `Track` ADD COLUMN `registeredAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `Transaction` ADD COLUMN `blockNumber` BIGINT UNSIGNED NULL,
    ADD COLUMN `chainId` VARCHAR(78) NULL;

-- AlterTable
ALTER TABLE `RevenueWithdrawal` ADD COLUMN `walletAddress` VARCHAR(42) NULL;

-- AlterTable
ALTER TABLE `PurchaseRequest` ADD COLUMN `buyerWalletAddress` VARCHAR(42) NULL;

-- CreateTable
CREATE TABLE `BlockchainEvent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `chainId` VARCHAR(78) NOT NULL,
    `transactionHash` VARCHAR(66) NOT NULL,
    `logIndex` INTEGER NOT NULL,
    `contractAddress` VARCHAR(42) NOT NULL,
    `eventName` VARCHAR(64) NOT NULL,
    `blockNumber` BIGINT UNSIGNED NOT NULL,
    `blockHash` VARCHAR(66) NOT NULL,
    `payload` JSON NOT NULL,
    `processedAt` DATETIME(3) NULL,
    `error` TEXT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,

    INDEX `BlockchainEvent_chainId_processedAt_blockNumber_idx`(`chainId`, `processedAt`, `blockNumber`),
    UNIQUE INDEX `BlockchainEvent_chainId_transactionHash_logIndex_key`(`chainId`, `transactionHash`, `logIndex`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BlockchainCursor` (
    `chainId` VARCHAR(78) NOT NULL,
    `blockNumber` BIGINT UNSIGNED NOT NULL,
    `blockHash` VARCHAR(66) NOT NULL,

    PRIMARY KEY (`chainId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
