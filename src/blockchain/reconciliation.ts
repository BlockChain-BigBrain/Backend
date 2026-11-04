import { createHash } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import { Prisma, PrismaClient } from "@prisma/client";
import { ChainClient } from "./client";
import { inspectChainState } from "./identity";

type Reader = PrismaClient | Prisma.TransactionClient;
export function requireLocalDevelopment(env = process.env, mutate = false) {
  const rpc = new URL(env.BLOCKCHAIN_RPC_URL || "http://127.0.0.1:8545");
  const db = new URL(env.DATABASE_URL || "invalid:");
  const loopback = (url: URL) => ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (env.NODE_ENV !== "development" || env.BLOCKCHAIN_NETWORK !== "hardhat" || env.BLOCKCHAIN_CHAIN_ID !== "31337" || rpc.protocol !== "http:" || !loopback(rpc) || rpc.username || rpc.password || db.protocol !== "mysql:" || !loopback(db)) throw new Error("Local development Hardhat 31337 and loopback MySQL/RPC are required");
  const database = decodeURIComponent(db.pathname.slice(1));
  if (!/^[A-Za-z0-9_]+$/.test(database) || db.searchParams.has("host")) throw new Error("Unsupported database URL");
  if (mutate && (env.LOCAL_CHAIN_RECONCILE_ALLOWED !== "1" || env.LOCAL_CHAIN_RECONCILE_DATABASE !== database)) throw new Error("Set LOCAL_CHAIN_RECONCILE_ALLOWED=1 and LOCAL_CHAIN_RECONCILE_DATABASE to the exact dedicated development database name");
  return { database, db };
}

export async function readChainRows(db: Reader) {
  const [tracks, registrations, purchases, licenses, transactions, allocations, withdrawals, listings, events, cursors, identities] = await Promise.all([
    db.track.findMany({ orderBy: { id: "asc" } }), db.registrationRequest.findMany({ orderBy: { id: "asc" } }),
    db.purchaseRequest.findMany({ orderBy: { id: "asc" } }), db.license.findMany({ orderBy: { id: "asc" } }),
    db.transaction.findMany({ orderBy: { id: "asc" } }), db.revenueAllocation.findMany({ orderBy: { id: "asc" } }),
    db.revenueWithdrawal.findMany({ orderBy: { id: "asc" } }), db.marketplaceListing.findMany({ orderBy: { id: "asc" } }),
    db.blockchainEvent.findMany({ orderBy: { id: "asc" } }), db.blockchainCursor.findMany({ orderBy: { chainId: "asc" } }),
    db.blockchainIdentity.findMany({ orderBy: { chainId: "asc" } }),
  ]);
  return { tracks, registrations, purchases, licenses, transactions, allocations, withdrawals, listings, events, cursors, identities };
}
export type ChainRows = Awaited<ReturnType<typeof readChainRows>>;
export const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item)).digest("hex");
export function resetPlan(rows: ChainRows) {
  const local = "31337";
  // Models without chainId cannot safely be partitioned in a multi-network database.
  if ([...rows.registrations, ...rows.transactions, ...rows.events, ...rows.cursors, ...rows.identities].some(row => row.chainId && row.chainId !== local)) throw new Error("Mixed-network database: automatic local reconciliation refused");
  const registrations = rows.registrations.filter(row => row.chainId === local && row.source !== "MOCK");
  const trackIds = new Set(registrations.map(row => row.trackId));
  for (const row of rows.transactions) if (row.chainId === local) trackIds.add(row.trackId);
  for (const row of rows.tracks) if ((row.registrationStatus !== "NOT_REGISTERED" || row.registrationTxHash || row.blockchainTrackId) && !trackIds.has(row.id) && !rows.registrations.some(r => r.trackId === row.id && r.source === "MOCK")) throw new Error(`Track ${row.id} has unscoped blockchain state; manual attribution required`);
  const transactions = rows.transactions.filter(row => row.chainId === local);
  const transactionIds = new Set(transactions.map(row => row.id));
  const allocations = rows.allocations.filter(row => transactionIds.has(row.transactionId));
  const recipients = new Set(allocations.map(row => row.userId));
  const purchases = rows.purchases.filter(row => trackIds.has(row.trackId) && !row.preparation && row.source !== "MOCK");
  const purchaseIds = new Set(purchases.map(row => row.id));
  const licenseIds = new Set([...transactions.flatMap(row => row.licenseId ? [row.licenseId] : []), ...purchases.flatMap(row => row.licenseId ? [row.licenseId] : [])]);
  const licenses = rows.licenses.filter(row => licenseIds.has(row.id) || row.source === "REAL" && trackIds.has(row.trackId));
  for (const row of licenses) licenseIds.add(row.id);
  // Abort rather than cascading into mock, off-chain or unattributable real payments.
  if (rows.transactions.some(row => !transactionIds.has(row.id) && (row.source === "REAL" || row.purchaseRequestId && purchaseIds.has(row.purchaseRequestId) || row.licenseId && licenseIds.has(row.licenseId))) || rows.purchases.some(row => !purchaseIds.has(row.id) && row.licenseId && licenseIds.has(row.licenseId)) || rows.licenses.some(row => row.source === "REAL" && !licenseIds.has(row.id))) throw new Error("Unscoped or shared real financial records; manual attribution required");
  const withdrawals = rows.withdrawals.filter(row => row.walletAddress && row.currency === "ETH" && recipients.has(row.userId));
  if (rows.withdrawals.some(row => (row.txHash || row.walletAddress) && !withdrawals.some(w => w.id === row.id))) throw new Error("Unscoped withdrawal: cannot prove association with local allocations");
  const listings = rows.listings.filter(row => trackIds.has(row.trackId) && row.status === "ACTIVE");
  const ids = { tracks: [...trackIds].sort((a,b) => a-b), registrations: registrations.map(r => r.id), transactions: transactions.map(r => r.id), allocations: allocations.map(r => r.id), purchases: purchases.map(r => r.id), licenses: licenses.map(r => r.id), withdrawals: withdrawals.map(r => r.id), listings: listings.map(r => r.id) };
  return { ids, counts: { ...Object.fromEntries(Object.entries(ids).map(([key, value]) => [key, value.length])), events: rows.events.filter(r => r.chainId === local).length, cursors: rows.cursors.filter(r => r.chainId === local).length, identities: rows.identities.filter(r => r.chainId === local).length }, fingerprint: digest(rows), changes: ["Delete selected allocations, transactions, purchases, licenses, withdrawals, registration requests and local events/cursor", "Reset Track registrationStatus/blockchainTrackId/registeredAt/registrationTxHash only", "Deactivate active local listings; preserve listing terms", "Replace durable local chain identity", "Preserve users/auth/wallets, tracks/audio/hash, contributors/invitations/shares/finalization, AI evidence, metadata snapshots and all CIDs/files"] };
}

export async function reconcileChain(db: PrismaClient, chain: ChainClient, expected: ReturnType<typeof resetPlan>, authorization: { confirmation: string; backupPath: string; backupSha256: string }) {
  if (authorization?.confirmation !== "RESET_LOCAL_CHAIN_31337") throw new Error("Explicit reset confirmation is required");
  requireLocalDevelopment(process.env, true);
  const stat = await lstat(authorization.backupPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || (stat.mode & 0o077) !== 0) throw new Error("A private complete SQL backup is required");
  const backup = await readFile(authorization.backupPath);
  if (!backup.includes(Buffer.from("CREATE TABLE")) || createHash("sha256").update(backup).digest("hex") !== authorization.backupSha256) throw new Error("Backup checksum mismatch");
  return db.$transaction(async tx => {
    const lock = await tx.$queryRaw<Array<{ acquired: number }>>`SELECT GET_LOCK('track-ai-local-chain-reconcile', 0) AS acquired`;
    if (Number(lock[0]?.acquired) !== 1) throw new Error("Another reconciliation is running");
    try {
      const plan = resetPlan(await readChainRows(tx));
      if (plan.fingerprint !== expected.fingerprint) throw new Error("DB changed since preview/backup; run dry-run again");
      const before = await inspectChainState(tx, chain);
      if (!before.deploymentReady || !before.identity) throw new Error("Import a healthy current local deployment before reconciliation");
      if (before.consistent) throw new Error("Chain is consistent; refusing unnecessary reset");
      const where = (id: number[]) => ({ id: { in: id } });
      await tx.revenueAllocation.deleteMany({ where: where(plan.ids.allocations) });
      await tx.transaction.deleteMany({ where: where(plan.ids.transactions) });
      await tx.purchaseRequest.deleteMany({ where: where(plan.ids.purchases) });
      await tx.license.deleteMany({ where: where(plan.ids.licenses) });
      await tx.revenueWithdrawal.deleteMany({ where: where(plan.ids.withdrawals) });
      await tx.registrationRequest.deleteMany({ where: where(plan.ids.registrations) });
      await tx.marketplaceListing.updateMany({ where: where(plan.ids.listings), data: { status: "INACTIVE", activeTrackId: null } });
      await tx.track.updateMany({ where: where(plan.ids.tracks), data: { registrationStatus: "NOT_REGISTERED", blockchainTrackId: null, registeredAt: null, registrationTxHash: null } });
      await tx.blockchainEvent.deleteMany({ where: { chainId: "31337" } });
      await tx.blockchainCursor.deleteMany({ where: { chainId: "31337" } });
      const after = await inspectChainState(tx, chain);
      // Old identity is expected to mismatch until it is replaced; anchor the exact
      // same chain observed before deleting anything, not a restarted node mid-reset.
      if (!after.identity || digest(after.identity) !== digest(before.identity)) throw new Error("Chain changed during reconciliation; rolled back");
      await tx.blockchainIdentity.upsert({ where: { chainId: "31337" }, create: before.identity, update: before.identity });
      return plan.counts;
    } finally { await tx.$queryRaw`SELECT RELEASE_LOCK('track-ai-local-chain-reconcile')`; }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60000 });
}
