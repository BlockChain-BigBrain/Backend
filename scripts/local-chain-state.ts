import "../src/config";
import { PrismaClient } from "@prisma/client";
import { chainClient } from "../src/blockchain/client";
import { inspectChainState } from "../src/blockchain/identity";
import { readChainRows, reconcileChain, requireLocalDevelopment, resetPlan } from "../src/blockchain/reconciliation";
import { createConnection } from "node:net";
import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

async function requireBackendStopped() {
  const port = Number(process.env.PORT || 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid Backend port");
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); reject(new Error("Stop Backend and all chain writers before reconciliation")); });
    socket.once("error", (error: NodeJS.ErrnoException) => error.code === "ECONNREFUSED" ? resolve() : reject(new Error("Cannot verify Backend is stopped")));
    socket.setTimeout(2000, () => { socket.destroy(); reject(new Error("Cannot verify Backend is stopped")); });
  });
}
async function backup(database: string, dbUrl: URL, directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = path.resolve(directory, `before-chain-reset-${Date.now()}-${randomUUID()}.sql`);
  const common = ["--single-transaction", "--skip-lock-tables", "--no-tablespaces", "--set-gtid-purged=OFF", "--hex-blob", database];
  const container = process.env.LOCAL_CHAIN_BACKUP_CONTAINER;
  if (container && dbUrl.port !== "33306") throw new Error("Container backup requires the local Compose MySQL endpoint on port 33306");
  // Credentials are passed in environment only; never in argv, output or repository files.
  const child = container
    ? spawn("docker", ["exec", "-i", container, "sh", "-c", 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -u root "$@"', "sh", ...common], { stdio: ["ignore", "pipe", "pipe"] })
    : spawn(process.env.LOCAL_CHAIN_MYSQLDUMP_BIN || "mysqldump", ["--no-defaults", "-h", dbUrl.hostname, "-P", dbUrl.port || "3306", "-u", decodeURIComponent(dbUrl.username), ...common], { env: { ...process.env, MYSQL_PWD: decodeURIComponent(dbUrl.password) }, stdio: ["ignore", "pipe", "pipe"] });
  child.stderr.resume();
  const completed = new Promise<void>((resolve, reject) => {
    child.once("error", () => reject(new Error("Backup tool unavailable; no reconciliation performed")));
    child.once("close", code => code === 0 ? resolve() : reject(new Error("mysqldump failed; no reconciliation performed")));
  });
  try {
    await Promise.all([pipeline(child.stdout, createWriteStream(filename, { flags: "wx", mode: 0o600 })), completed]);
    const handle = await open(filename, "r+");
    try { await handle.sync(); } finally { await handle.close(); }
    const bytes = await readFile(filename);
    if (!bytes.length || !bytes.includes(Buffer.from("CREATE TABLE"))) throw new Error("Backup has no schema; refusing reset");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await writeFile(filename + ".sha256", sha256 + "\n", { flag: "wx", mode: 0o600 });
    return { filename, sha256 };
  } catch (error) { child.kill(); await unlink(filename).catch(() => {}); throw error; }
}
const db = new PrismaClient();
async function main() {
  const args = process.argv.slice(2), command = args.shift();
  if (!["check", "dry", "reconcile"].includes(command || "") || args.some(arg => arg !== "--confirm=RESET_LOCAL_CHAIN_31337")) throw new Error("Usage: local:chain:check | local:chain:reconcile:dry | local:chain:reconcile -- --confirm=RESET_LOCAL_CHAIN_31337");
  const target = requireLocalDevelopment();
  const [state, rows] = await Promise.all([inspectChainState(db, chainClient), readChainRows(db)]);
  const plan = resetPlan(rows);
  console.log(JSON.stringify({ command, consistent: state.consistent, deploymentReady: state.deploymentReady, reasons: state.reasons, counts: plan.counts, ids: plan.ids, changes: plan.changes }, null, 2));
  if (command === "check") { process.exitCode = state.consistent ? 0 : 2; return; }
  if (command === "dry") return;
  requireLocalDevelopment(process.env, true);
  if (!args.includes("--confirm=RESET_LOCAL_CHAIN_31337")) throw new Error("No changes: pass --confirm=RESET_LOCAL_CHAIN_31337 explicitly after reviewing dry-run");
  if (!state.deploymentReady) throw new Error("Import the fresh healthy deployment using local:chain before resetting DB");
  if (state.consistent) throw new Error("No changes: chain already consistent");
  await requireBackendStopped();
  const saved = await backup(target.database, target.db, path.resolve(process.env.LOCAL_CHAIN_BACKUP_DIR || ".local-chain-backups"));
  console.log(JSON.stringify({ backup: saved.filename, sha256: saved.sha256 }));
  await requireBackendStopped();
  const result = await reconcileChain(db, chainClient, plan, { confirmation: "RESET_LOCAL_CHAIN_31337", backupPath: saved.filename, backupSha256: saved.sha256 });
  const verified = await inspectChainState(db, chainClient);
  if (!verified.consistent) throw new Error("Post-reset check failed; keep Backend stopped");
  console.log(JSON.stringify({ reconciled: true, counts: result, next: "Restart Backend with npm run dev:services. No worker was restarted automatically." }));
}
main().catch(error => { console.error(error?.code === "P2021" ? "Chain identity schema is missing; run npm run local:migrate before checking/reconciling" : error instanceof Error ? error.message : "Reconciliation failed; keep Backend stopped"); process.exitCode = 1; }).finally(async () => { await db.$disconnect(); await chainClient.provider.destroy(); });
