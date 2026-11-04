import { createHash } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { ChainClient, names } from "./client";
import { AppError } from "../utils/errors";

export async function inspectChainState(db: PrismaClient | Prisma.TransactionClient, chain: ChainClient) {
  const health = await chain.health();
  if (!health.connected) return { consistent: false, deploymentReady: false, reasons: [health.error || "RPC unavailable"], identity: null };
  const [genesis, head, stored, cursor] = await Promise.all([
    chain.provider.getBlock(0), chain.provider.getBlock("latest"),
    db.blockchainIdentity.findUnique({ where: { chainId: chain.chainId } }),
    db.blockchainCursor.findUnique({ where: { chainId: chain.chainId } }),
  ]);
  if (!genesis?.hash || !head?.hash) throw new AppError(503, "Chain identity blocks unavailable");
  const deploymentFingerprint = createHash("sha256").update(JSON.stringify(names.map(name => [name, chain.addresses[name].toLowerCase(), chain.manifest.runtimeCodeHashes[name]]))).digest("hex");
  const identity = { chainId: chain.chainId, genesisHash: genesis.hash, deploymentFingerprint, blockNumber: BigInt(head.number), blockHash: head.hash };
  const reasons: string[] = [];
  if (stored) {
    if (stored.genesisHash !== genesis.hash) reasons.push("Genesis hash changed");
    if (stored.deploymentFingerprint !== deploymentFingerprint) reasons.push("Deployment addresses/runtime code changed");
    if ((await chain.provider.getBlock(Number(stored.blockNumber)))?.hash !== stored.blockHash) reasons.push("Saved identity block changed or disappeared");
  }
  if (cursor && (await chain.provider.getBlock(Number(cursor.blockNumber)))?.hash !== cursor.blockHash) reasons.push("Finalized cursor reorg/restart detected; reconcile DB before resuming");
  // Without a cursor, inspect all durable proofs, not just chainId. Pending
  // unsigned requests can be trusted only if a durable identity already exists.
  if (!stored || !cursor) {
    const [registrations, transactions, events, withdrawals, tracks, licenses] = await Promise.all([
      db.registrationRequest.findMany({ where: { chainId: chain.chainId, source: { not: "MOCK" } } }),
      db.transaction.findMany({ where: { OR: [{ chainId: chain.chainId }, { chainId: null, source: "REAL" }] } }),
      db.blockchainEvent.findMany({ where: { chainId: chain.chainId } }),
      db.revenueWithdrawal.findMany({ where: { txHash: { not: null }, currency: "ETH" } }),
      db.track.findMany({ where: { OR: [{ registrationStatus: { not: "NOT_REGISTERED" } }, { registrationTxHash: { not: null } }, { blockchainTrackId: { not: null } }] } }),
      db.license.findMany({ where: { OR: [{ source: "REAL" }, { tokenId: { not: null } }] } }),
    ]);
    const proofs = new Map<string, { blockHash?: string; blockNumber?: bigint }>();
    for (const row of registrations) {
      if (row.contractAddress?.toLowerCase() !== chain.addresses.TrackRegistry.toLowerCase()) reasons.push(`Registration ${row.id} belongs to another deployment`);
      if (row.txHash) proofs.set(row.txHash, {});
      else if (!stored) reasons.push(`Registration ${row.id} has no anchored identity or transaction proof`);
    }
    for (const row of transactions) if (row.txHash) proofs.set(row.txHash, { blockNumber: row.blockNumber ?? undefined }); else if (!stored) reasons.push(`Transaction ${row.id} has no proof`);
    for (const row of withdrawals) if (row.txHash) proofs.set(row.txHash, {});
    for (const row of tracks) if (row.registrationTxHash) proofs.set(row.registrationTxHash, {}); else if (!stored) reasons.push(`Track ${row.id} has no registration proof`);
    for (const row of licenses) if (row.purchaseTxHash) proofs.set(row.purchaseTxHash, {}); else reasons.push(`License ${row.id} has no issuance proof`);
    for (const event of events) proofs.set(event.transactionHash, { blockHash: event.blockHash, blockNumber: event.blockNumber });
    for (const [hash, expected] of proofs) {
      const receipt = await chain.provider.getTransactionReceipt(hash);
      const canonical = receipt && await chain.provider.getBlock(receipt.blockNumber);
      if (!receipt || receipt.status !== 1 || receipt.blockHash !== canonical?.hash || expected.blockHash && expected.blockHash !== receipt.blockHash || expected.blockNumber !== undefined && expected.blockNumber !== BigInt(receipt.blockNumber)) reasons.push(`Missing or noncanonical saved receipt ${hash}`);
      if (receipt && !receipt.logs.some(log => names.some(name => log.address.toLowerCase() === chain.addresses[name].toLowerCase()))) reasons.push(`Receipt ${hash} belongs to another deployment`);
    }
  }
  return { consistent: reasons.length === 0, deploymentReady: true, reasons, identity };
}

export async function guardChainState(db: PrismaClient, chain: ChainClient) {
  const report = await inspectChainState(db, chain);
  if (!report.consistent || !report.identity) {
    chain.blockedReason = report.reasons.join("; ");
    throw new AppError(503, chain.blockedReason);
  }
  // Never rewrite an existing identity on startup. CLI check and dry-run do not call this.
  await db.blockchainIdentity.upsert({ where: { chainId: chain.chainId }, create: report.identity, update: {} });
}
