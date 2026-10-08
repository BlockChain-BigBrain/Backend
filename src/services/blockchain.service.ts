import { randomBytes } from "node:crypto";
import { AbiCoder, id as utf8Hash, keccak256, TypedDataEncoder, Wallet, verifyTypedData } from "ethers";
import { Prisma, RegistrationRequest } from "@prisma/client";
import { riskStatus, wallet } from "../dto/rights.dto";
import { BlockchainProvider } from "../providers/blockchain.provider";
import { own, RightsRepository, RightsTrack } from "../repositories/rights.repository";
import { creatorShares } from "./contribution.service";
import { cidBytes, snapshotMatchesTrack, validCid } from "./metadata.service";
import { AppError } from "../utils/errors";

const fields = {
  audioHash: "bytes32", metadataCIDHash: "bytes32", registrant: "address", contributorsHash: "bytes32",
  similarityScore: "uint256", modelVersion: "string", nonce: "uint256", deadline: "uint256",
} as const;
export interface HashingRules {
  metadataEncoding: "UTF8" | "CID_BYTES";
  contributorsEncoding: "ABI_ARRAYS" | "ABI_TUPLES";
  similarityScale: number;
  percentageScale: number;
}
const defaultHashing: HashingRules = { metadataEncoding: "UTF8", contributorsEncoding: "ABI_ARRAYS", similarityScale: 10000, percentageScale: 100 };
export interface BlockchainOptions {
  chainId: string; contractAddress?: string; name: string; version: string;
  primaryType: string; fieldOrder: Array<keyof typeof fields>; fieldTypes?: Record<keyof typeof fields, string>; hashingRules?: HashingRules; signingKey?: string; signerAddress?: string; ttlSeconds: number; confirmations: number;
}
export function blockchainOptions(): BlockchainOptions {
  const network = process.env.BLOCKCHAIN_NETWORK ?? "unconfigured";
  if (!["unconfigured", "hardhat", "amoy"].includes(network)) throw new Error("Invalid BLOCKCHAIN_NETWORK");
  const chainId = process.env.BLOCKCHAIN_CHAIN_ID ?? (network === "amoy" ? "80002" : "31337");
  if (!/^[1-9]\d*$/.test(chainId) || BigInt(chainId) >= 2n ** 256n) throw new Error("Invalid BLOCKCHAIN_CHAIN_ID");
  const order = (process.env.EIP712_FIELD_ORDER ?? Object.keys(fields).join(",")).split(",");
  if (order.length !== 8 || new Set(order).size !== 8 || order.some(field => !(field in fields))) throw new Error("Invalid EIP712_FIELD_ORDER");
  const ttlSeconds = Number(process.env.REGISTRATION_TTL_SECONDS ?? 900), confirmations = Number(process.env.BLOCKCHAIN_CONFIRMATIONS ?? 2);
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 86400 || !Number.isSafeInteger(confirmations) || confirmations < 1) throw new Error("Invalid blockchain expiry/confirmations");
  const primaryType = process.env.EIP712_PRIMARY_TYPE ?? "TrackVerification";
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(primaryType) || primaryType === "EIP712Domain") throw new Error("Invalid EIP712_PRIMARY_TYPE");
  let fieldTypes: Record<keyof typeof fields, string> = { ...fields };
  let hashingRules: HashingRules = { ...defaultHashing };
  try {
    const types = JSON.parse(process.env.EIP712_FIELD_TYPES_JSON ?? "{}");
    const hashing = JSON.parse(process.env.EIP712_HASHING_JSON ?? "{}");
    if (!types || typeof types !== "object" || Array.isArray(types) || !hashing || typeof hashing !== "object" || Array.isArray(hashing)) throw new Error();
    if (Object.keys(types).some(key => !(key in fields)) || Object.keys(hashing).some(key => !(key in defaultHashing))) throw new Error();
    fieldTypes = { ...fieldTypes, ...types }; hashingRules = { ...hashingRules, ...hashing };
    for (const key of ["audioHash", "metadataCIDHash", "registrant", "contributorsHash", "nonce"] as const) if (fieldTypes[key] !== fields[key]) throw new Error();
    if (!["string", "bytes32"].includes(fieldTypes.modelVersion) || !["uint16", "uint32", "uint64", "uint256"].includes(fieldTypes.similarityScore) || !["uint64", "uint256"].includes(fieldTypes.deadline)) throw new Error();
    if (!["UTF8", "CID_BYTES"].includes(hashingRules.metadataEncoding) || !["ABI_ARRAYS", "ABI_TUPLES"].includes(hashingRules.contributorsEncoding) || ![10000, 100000, 1000000].includes(hashingRules.similarityScale) || ![100, 1000, 10000, 100000, 1000000].includes(hashingRules.percentageScale)) throw new Error();
    if (BigInt(hashingRules.similarityScale) >= 2n ** BigInt(fieldTypes.similarityScore.slice(4))) throw new Error();
  } catch { throw new Error("Invalid EIP712_FIELD_TYPES_JSON or EIP712_HASHING_JSON"); }
  const options: BlockchainOptions = {
    chainId, contractAddress: process.env.TRACK_REGISTRY_ADDRESS || undefined,
    name: process.env.EIP712_DOMAIN_NAME ?? "TrackRegistry", version: process.env.EIP712_DOMAIN_VERSION ?? "1", primaryType,
    fieldTypes, hashingRules, fieldOrder: order as Array<keyof typeof fields>, signingKey: process.env.VERIFICATION_SIGNER_PRIVATE_KEY || undefined,
    signerAddress: process.env.VERIFICATION_SIGNER_ADDRESS || undefined, ttlSeconds, confirmations,
  };
  if (options.contractAddress) options.contractAddress = wallet(options.contractAddress);
  if (options.signingKey) {
    let signer: Wallet;
    try { signer = new Wallet(options.signingKey); } catch { throw new Error("Invalid verification signing key"); }
    if (!options.signerAddress || wallet(options.signerAddress) !== signer.address.toLowerCase()) throw new Error("Verification signer address does not match the private key");
  }
  return options;
}
export function registrationPrerequisites(track: RightsTrack, options: BlockchainOptions): string[] {
  const missing: string[] = [];
  if (!track.audioHash || !/^[a-f0-9]{64}$/.test(track.audioHash)) missing.push("audioHash");
  const snapshot = track.metadataSnapshots[0];
  if (!validCid(track.metadataCid) || !snapshot || snapshot.status !== "UPLOADED" || snapshot.metadataCid !== track.metadataCid || !snapshotMatchesTrack(track)) missing.push("realMetadataCid");
  const verification = track.verifications[0];
  if (!verification || verification.status !== "VERIFIED" || verification.source !== "AI" || verification.duplicate !== false || verification.riskScore === null || !verification.modelVersion || !["PASS", "WARN"].includes(verification.riskStatus ?? "") || riskStatus(verification.riskScore.toNumber()) !== verification.riskStatus) missing.push("realEligibleAiVerification");
  if (snapshot && verification && (snapshot.document as Record<string, any>).verification?.id !== verification.id) missing.push("currentMetadataVerification");
  if (!track.contributionsFinalizedAt) missing.push("finalizedContributions");
  try { wallet(track.owner.walletAddress); creatorShares(track); } catch { missing.push("creatorWallets"); }
  if (!options.contractAddress) missing.push("contractAddress");
  if (!options.signingKey || !options.signerAddress) missing.push("verificationSigner");
  return [...new Set(missing)];
}
export function typedRegistration(track: RightsTrack, request: RegistrationRequest, options: BlockchainOptions) {
  if (request.deadline.getTime() <= Date.now()) throw new AppError(409, "Registration signature is expired");
  const missing = registrationPrerequisites(track, options);
  if (missing.length) return { ready: false as const, missing, typedData: null };
  const shares = creatorShares(track);
  const hashing = options.hashingRules ?? defaultHashing, fieldTypes = options.fieldTypes ?? fields;
  const addresses = shares.map(item => item.walletAddress);
  const percentages = shares.map(item => BigInt(new Prisma.Decimal(item.percentage).mul(hashing.percentageScale).toFixed(0)));
  const encoded = hashing.contributorsEncoding === "ABI_ARRAYS"
    ? AbiCoder.defaultAbiCoder().encode(["address[]", "uint256[]"], [addresses, percentages])
    : AbiCoder.defaultAbiCoder().encode(["tuple(address wallet,uint256 percentage)[]"], [addresses.map((address, index) => [address, percentages[index]])]);
  const contributorsHash = keccak256(encoded);
  const metadataCIDHash = hashing.metadataEncoding === "UTF8" ? utf8Hash(track.metadataCid!) : keccak256(cidBytes(track.metadataCid!)!);
  const verification = track.verifications[0];
  return { ready: true as const, missing: [], typedData: {
    domain: { name: options.name, version: options.version, chainId: options.chainId, verifyingContract: options.contractAddress! },
    primaryType: options.primaryType,
    types: { [options.primaryType]: options.fieldOrder.map(name => ({ name, type: fieldTypes[name] })) },
    value: { audioHash: `0x${track.audioHash}`, metadataCIDHash, registrant: wallet(track.owner.walletAddress), contributorsHash,
      similarityScore: verification.riskScore!.mul(hashing.similarityScale).toFixed(0), modelVersion: fieldTypes.modelVersion === "bytes32" ? utf8Hash(verification.modelVersion!) : verification.modelVersion!, nonce: request.nonce, deadline: String(Math.floor(request.deadline.getTime() / 1000)) },
  } };
}
export class BlockchainService {
  constructor(private readonly repo: RightsRepository, private readonly provider: BlockchainProvider, private readonly options: BlockchainOptions = blockchainOptions()) {}
  async register(id: number, userId: number) {
    return this.repo.locked(id, async (tx, track) => {
      own(track, userId);
      if (track.registrationStatus === "REGISTERED" || track.registrationTxHash || track.blockchainTrackId) throw new AppError(409, "Track is already registered");
      let request = track.registrationRequests[0];
      if (request?.status === "PENDING" && request.deadline.getTime() > Date.now() && request.signature) throw new AppError(409, "Registration is already pending");
      if (!request || request.status !== "PENDING" || request.deadline.getTime() <= Date.now()) {
        if (request?.status === "PENDING") await tx.registrationRequest.update({ where: { id: request.id }, data: { status: "FAILED", errorCode: "EXPIRED", errorMessage: "Signature expired" } });
        request = await tx.registrationRequest.create({ data: { trackId: id, nonce: BigInt(`0x${randomBytes(32).toString("hex")}`).toString(), deadline: new Date(Date.now() + this.options.ttlSeconds * 1000), chainId: this.options.chainId, contractAddress: this.options.contractAddress } });
      }
      const payload = typedRegistration(track, request, this.options);
      if (!payload.ready) {
        await tx.track.update({ where: { id }, data: { registrationStatus: "NOT_REGISTERED" } });
        return { request, ...payload, stage: "PREPARATION", sent: false };
      }
      const signer = new Wallet(this.options.signingKey!);
      if (wallet(this.options.signerAddress) !== signer.address.toLowerCase()) throw new AppError(503, "Signer address mismatch");
      const { domain, types, value } = payload.typedData;
      const signature = await signer.signTypedData(domain, types, value);
      if (verifyTypedData(domain, types, value, signature).toLowerCase() !== wallet(this.options.signerAddress)) throw new AppError(503, "Signature validation failed");
      request = await tx.registrationRequest.update({ where: { id: request.id }, data: { typedData: payload.typedData as Prisma.InputJsonValue, signature, chainId: this.options.chainId, contractAddress: this.options.contractAddress!, metadataSnapshotId: track.metadataSnapshots[0].id } });
      await tx.track.update({ where: { id }, data: { registrationStatus: "PENDING" } });
      return { request, ...payload, signature, stage: "SIGNED_PREPARATION", sent: false };
    });
  }
  async payload(id: number, userId: number) {
    const track = await this.repo.track(id, userId, true), request = track.registrationRequests[0];
    if (!request) return { ready: false, missing: ["registrationRequest", ...registrationPrerequisites(track, this.options)], typedData: null };
    const packet = typedRegistration(track, request, this.options);
    if (packet.ready && request.signature) {
      const stored = request.typedData as any;
      if (!stored || TypedDataEncoder.hash(stored.domain, stored.types, stored.value) !== TypedDataEncoder.hash(packet.typedData.domain, packet.typedData.types, packet.typedData.value) || verifyTypedData(packet.typedData.domain, packet.typedData.types, packet.typedData.value, request.signature).toLowerCase() !== wallet(this.options.signerAddress)) return { ready: false, missing: ["signedPayloadChanged"], typedData: null, signature: null, requestId: request.id };
    }
    return { ...packet, signature: packet.ready ? request.signature : null, requestId: request.id };
  }
  async status(id: number, userId: number) {
    const track = await this.repo.track(id, userId, true);
    return { registrationStatus: track.registrationStatus, blockchainTrackId: track.blockchainTrackId, txHash: track.registrationTxHash, providerConfigured: this.provider.configured, request: track.registrationRequests[0] ?? null };
  }
  async confirm(id: number, userId: number, txHash: string) {
    if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) throw new AppError(400, "Invalid transaction hash");
    const track = await this.repo.track(id, userId, true), request = track.registrationRequests[0];
    if (!request || request.status !== "PENDING" || !request.signature || !request.typedData) throw new AppError(409, "Signed registration request is required");
    const packet = typedRegistration(track, request, this.options);
    if (!packet.ready) throw new AppError(409, "Registration prerequisites changed");
    const digest = TypedDataEncoder.hash(packet.typedData.domain, packet.typedData.types, packet.typedData.value);
    const stored = request.typedData as any;
    if (TypedDataEncoder.hash(stored.domain, stored.types, stored.value) !== digest) throw new AppError(409, "Signed registration inputs changed");
    const expectation = { txHash, trackId: id, chainId: request.chainId, contractAddress: request.contractAddress!, nonce: request.nonce, registrant: packet.typedData.value.registrant, payloadDigest: digest };
    const receipt = await this.provider.verifyRegistration(expectation);
    if (receipt.source !== "REAL" || receipt.confirmed !== true || !Number.isSafeInteger(receipt.confirmations) || receipt.confirmations < this.options.confirmations || !/^\d{1,78}$/.test(receipt.blockchainTrackId) || BigInt(receipt.blockchainTrackId) >= 2n ** 256n || Object.entries(expectation).some(([key, value]) => receipt[key as keyof typeof receipt] !== value)) throw new AppError(502, "Unverified or mismatched registration receipt");
    return this.repo.locked(id, async (tx, current) => {
      own(current, userId);
      const latest = current.registrationRequests[0];
      if (!latest || latest.id !== request.id || latest.status !== "PENDING" || latest.deadline.getTime() <= Date.now()) throw new AppError(409, "Registration request changed or expired");
      const currentPayload = typedRegistration(current, latest, this.options);
      if (!currentPayload.ready || TypedDataEncoder.hash(currentPayload.typedData.domain, currentPayload.typedData.types, currentPayload.typedData.value) !== digest) throw new AppError(409, "Registration inputs changed");
      const confirmedAt = new Date();
      await tx.registrationRequest.update({ where: { id: request.id }, data: { status: "REGISTERED", source: "REAL", txHash, blockchainTrackId: receipt.blockchainTrackId, confirmedAt } });
      return tx.track.update({ where: { id }, data: { registrationStatus: "REGISTERED", registrationTxHash: txHash, blockchainTrackId: receipt.blockchainTrackId } });
    });
  }
  async cancel(id: number, userId: number) {
    return this.repo.locked(id, async (tx, track) => {
      own(track, userId); const request = track.registrationRequests[0];
      if (!request || request.status !== "PENDING" || request.signature) throw new AppError(409, "Only unsigned preparation requests may be cancelled; signed requests must expire");
      return tx.registrationRequest.update({ where: { id: request.id }, data: { status: "FAILED", errorCode: "CANCELLED" } });
    });
  }
}
