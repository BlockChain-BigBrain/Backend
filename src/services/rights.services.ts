import { PrismaClient } from "@prisma/client";
import { chainClient } from "../blockchain/client";
import { HttpAiVerificationProvider } from "../providers/http-ai.provider";
import { KuboStorageProvider } from "../providers/kubo-storage.provider";
import { config } from "../config";
import { MockAiVerificationProvider, UnconfiguredAiVerificationProvider } from "../providers/ai.provider";
import { UnconfiguredBlockchainProvider } from "../providers/blockchain.provider";
import { MockPaymentProvider, UnconfiguredPaymentProvider } from "../providers/payment.provider";
import { UnconfiguredStorageProvider } from "../providers/storage.provider";
import { RightsRepository } from "../repositories/rights.repository";
import { BlockchainService } from "./blockchain.service";
import { ContributionService } from "./contribution.service";
import { LicenseService } from "./license.service";
import { MarketplaceService } from "./marketplace.service";
import { MetadataService } from "./metadata.service";
import { RevenueService } from "./revenue.service";
import { TransactionService } from "./transaction.service";
import { WalletService } from "./wallet.service";
import { VerificationService } from "./verification.service";
export function createRightsServices(db: PrismaClient) {
  const repo = new RightsRepository(db);
  return {
    wallet: new WalletService(repo),
    contributions: new ContributionService(repo),
    verifications: new VerificationService(repo, config.aiProviderMode === "http" ? new HttpAiVerificationProvider() : config.aiProviderMode === "mock" ? new MockAiVerificationProvider() : new UnconfiguredAiVerificationProvider()),
    metadata: new MetadataService(repo, config.storageProviderMode === "kubo" ? new KuboStorageProvider() : new UnconfiguredStorageProvider()),
    blockchain: new BlockchainService(repo, chainClient.configured ? chainClient : new UnconfiguredBlockchainProvider()),
    marketplace: new MarketplaceService(repo),
    licenses: new LicenseService(repo, chainClient.configured ? new UnconfiguredPaymentProvider() : config.paymentProviderMode === "mock" ? new MockPaymentProvider() : new UnconfiguredPaymentProvider()),
    revenue: new RevenueService(repo), transactions: new TransactionService(repo),
  };
}
export type RightsServices = ReturnType<typeof createRightsServices>;

