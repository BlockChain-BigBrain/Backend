import { Currency, LicenseType, Prisma } from "@prisma/client";
import { AppError } from "../utils/errors";
export interface PaymentExpectation {
  requestId: number; buyerId: number; trackId: number; licenseType: LicenseType;
  amount: string; currency: Currency; preparation: boolean;
}
export interface PaymentReceipt {
  source: "REAL" | "MOCK"; buyerId: number; trackId: number; licenseType: LicenseType;
  amount: string; currency: Currency; paymentReference: string;
  paymentConfirmed: boolean; mintConfirmed: boolean; failed?: boolean;
  txHash?: string; tokenId?: string; chainId?: string; blockNumber?: bigint;
  allocations?: Array<{ userId: number; percentage: string; amount: string; currency: Currency }>;
}
export interface PaymentProvider {
  readonly source: "REAL" | "MOCK" | "UNCONFIGURED";
  verifyPayment(expected: PaymentExpectation): Promise<PaymentReceipt>;
}
export class UnconfiguredPaymentProvider implements PaymentProvider {
  readonly source = "UNCONFIGURED";
  async verifyPayment(_expected: PaymentExpectation): Promise<PaymentReceipt> { throw new AppError(503, "Payment/ERC-1155 provider is not configured"); }
}
export class MockPaymentProvider implements PaymentProvider {
  readonly source = "MOCK";
  async verifyPayment(expected: PaymentExpectation): Promise<PaymentReceipt> {
    return { ...expected, source: "MOCK", paymentReference: `mock:purchase:${expected.requestId}`, paymentConfirmed: true, mintConfirmed: true };
  }
}
export function matchingPayment(expected: PaymentExpectation, result: PaymentReceipt): void {
  let amountMatches = false;
  try { amountMatches = typeof result?.amount === "string" && new Prisma.Decimal(result.amount).eq(expected.amount); } catch { /* Invalid adapter result. */ }
  if (!result || !["REAL", "MOCK"].includes(result.source) || result.buyerId !== expected.buyerId || result.trackId !== expected.trackId || result.licenseType !== expected.licenseType || result.currency !== expected.currency || !amountMatches || typeof result.paymentReference !== "string" || !result.paymentReference || result.paymentReference.length > 191 || typeof result.paymentConfirmed !== "boolean" || typeof result.mintConfirmed !== "boolean" || (result.failed !== undefined && typeof result.failed !== "boolean") || (result.mintConfirmed && !result.paymentConfirmed) || (result.failed && result.paymentConfirmed)) throw new AppError(502, "Payment receipt does not match the purchase");
  if (result.source === "MOCK" && (!result.paymentReference.startsWith("mock:") || result.txHash || result.tokenId)) throw new AppError(502, "Mock receipts cannot contain real transaction/NFT identifiers");
  if (result.source === "REAL" && result.paymentConfirmed && (!result.txHash || !/^0x[a-fA-F0-9]{64}$/.test(result.txHash))) throw new AppError(502, "Payment receipt lacks a verified transaction hash");
  if (result.source === "REAL" && result.mintConfirmed && (!result.tokenId || !/^\d{1,78}$/.test(result.tokenId) || BigInt(result.tokenId) >= 2n ** 256n)) throw new AppError(502, "Mint receipt lacks a verified token ID");
  if (expected.preparation && result.source === "REAL") throw new AppError(409, "A preparation purchase cannot become a real license");
}
