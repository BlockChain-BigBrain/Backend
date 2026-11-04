CREATE TABLE `BlockchainIdentity` (
  `chainId` VARCHAR(78) NOT NULL,
  `genesisHash` VARCHAR(66) NOT NULL,
  `deploymentFingerprint` VARCHAR(64) NOT NULL,
  `blockNumber` BIGINT UNSIGNED NOT NULL,
  `blockHash` VARCHAR(66) NOT NULL,
  PRIMARY KEY (`chainId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
