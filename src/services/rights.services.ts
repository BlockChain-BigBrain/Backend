import { PrismaClient } from "@prisma/client";
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
    verifications: new VerificationService(repo, config.aiProviderMode === "mock" ? new MockAiVerificationProvider() : new UnconfiguredAiVerificationProvider()),
    metadata: new MetadataService(repo, new UnconfiguredStorageProvider()),
    blockchain: new BlockchainService(repo, new UnconfiguredBlockchainProvider()),
    marketplace: new MarketplaceService(repo),
    licenses: new LicenseService(repo, config.paymentProviderMode === "mock" ? new MockPaymentProvider() : new UnconfiguredPaymentProvider()),
    revenue: new RevenueService(repo), transactions: new TransactionService(repo),
  };
}
export type RightsServices = ReturnType<typeof createRightsServices>;
