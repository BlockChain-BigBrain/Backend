import { AppError } from "../utils/errors";
export interface RegistrationExpectation {
  txHash: string; trackId: number; chainId: string; contractAddress: string;
  nonce: string; registrant: string; payloadDigest: string;
}
export interface RegistrationReceipt extends RegistrationExpectation {
  source: "REAL"; confirmed: boolean; confirmations: number; blockchainTrackId: string;
}
export interface BlockchainProvider {
  readonly configured: boolean;
  verifyRegistration(expected: RegistrationExpectation): Promise<RegistrationReceipt>;
}
export class UnconfiguredBlockchainProvider implements BlockchainProvider {
  readonly configured = false;
  async verifyRegistration(_expected: RegistrationExpectation): Promise<RegistrationReceipt> { throw new AppError(503, "Blockchain ABI/provider is not configured; no transaction has been sent"); }
}
