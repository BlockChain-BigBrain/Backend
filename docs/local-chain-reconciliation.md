# Local Hardhat chain/DB reconciliation

Development-only recovery for a restarted chain 31337. Normal startup never deletes application data. Stop **all** Backend instances, sync workers and other chain writers before resetting. `local:chain` and `dev:services` retain their existing meaning.

## Install and check

```sh
npm run prisma:generate
npm run local:migrate
npm run local:chain          # separate terminal; keep it open
npm run local:chain:check
npm run local:chain:reconcile:dry
```

The migration adds only `BlockchainIdentity`; existing records are not reset. On first healthy use the Backend records genesis hash, a fingerprint of the four deployment addresses/runtime code hashes and a canonical checkpoint independently of `BlockchainCursor`. It never overwrites that identity on a normal restart. Every real chain operation and sync pass checks the saved identity/cursor. Deployment health also checks manifest genesis/anchor, contract bytecode and wiring. Without a cursor/identity, saved registration/payment/event receipts are validated against the live chain. RPC/DB failures cannot be treated as a fresh empty chain.

`check` exits 0 for consistency, 2 for a mismatch, and 1 for an operational/configuration error. `dry` prints counts, IDs and changed fields without creating an identity, backup or changing the DB. Missing/stale manifest or missing code requires a fresh deployment/import first. The same chainId alone is never sufficient. A perfectly replayed deterministic chain with identical hashes and state is cryptographically indistinguishable from the original; differing recorded anchors/proofs are detected.

## Confirm a reset

Review the preview first. Add to the untracked `.env.services.local` **only for a dedicated development DB**:

```dotenv
LOCAL_CHAIN_RECONCILE_ALLOWED=1
LOCAL_CHAIN_RECONCILE_DATABASE=track_ai
# The supplied local Compose container has mysqldump and its own root credentials:
LOCAL_CHAIN_BACKUP_CONTAINER=track-ai-mysql
```

Then, with Backend stopped:

```sh
npm run local:chain:reconcile -- --confirm=RESET_LOCAL_CHAIN_31337
npm run local:chain:check
npm run dev:services
```

The plain `npm run local:chain:reconcile` previews and refuses writes without the confirmation argument. `NODE_ENV=development`, `BLOCKCHAIN_NETWORK=hardhat`, explicit chainId 31337, local HTTP RPC, loopback MySQL, a matching DB-name opt-in, healthy fresh deployment and stopped Backend port are all required. A matching chain is never reset unnecessarily. Mixed-network databases and unscoped/shared real financial records are refused instead of guessed. The CLI is an operator tool, not an HTTP route. It cannot remotely stop other writers; stop them explicitly even if they use another port. A database named `track_ai` reached through a production SSH tunnel is **not** a development database and must never be opted in.

## Backup and atomicity

Before any reset, a complete `mysqldump` of the selected DB (schema and data) is written into ignored `.local-chain-backups/` with file mode 0600, fsynced and accompanied by a SHA-256 sidecar. This includes authentication hashes/private application data: keep backups private. Backup/tool failures abort before writes. Without the Compose option, install `mysqldump` or configure `LOCAL_CHAIN_MYSQLDUMP_BIN`; credentials are passed via `MYSQL_PWD`, never command arguments. `LOCAL_CHAIN_BACKUP_DIR` can select another private directory.

The selected rows are re-read under a serializable Prisma transaction and checked against the preview fingerprint. A MySQL advisory lock excludes a second reconciliation. Allocations → transactions → purchases → licenses are deleted in FK order, followed by selected withdrawals and registration requests; track/listing updates and local event/cursor deletion and new identity storage commit together. A changed chain/DB or FK error rolls everything back. No worker is resumed automatically on success or failure. Failure leaves the old mismatch in place; keep Backend stopped and investigate before retrying.

## Changed vs preserved

| Data | Action |
| --- | --- |
| User, credentials/refresh hashes, linked wallets, wallet challenges | Preserve |
| Track ID/title/visibility/prompt/work log/audioPath/audioHash/size/duration | Preserve |
| Audio files, local metadata files, IPFS content, all CIDs | Preserve |
| Contributions, accepted/pending invitations, percentages, finalized shares | Preserve |
| AI verifications/evidence and similarity results | Preserve; no AI calls |
| Metadata snapshots | Preserve |
| Local Track registrationStatus, blockchainTrackId, registeredAt, registrationTxHash | NOT_REGISTERED / null; updatedAt follows Prisma updates |
| Local registration requests, signed payloads, nonce/TX references | Delete |
| Local chain purchases, licenses/NFT issuance records, transactions, allocations, attributed ETH withdrawals | Delete |
| Active local listings | INACTIVE; clear activeTrackId; preserve terms/prices |
| Chain 31337 events and cursor | Delete |
| Durable local chain identity | Replace with current healthy chain identity |

Financial rows are attributed through local registration requests/chainId-bearing transactions and their FK graph. Mock/off-chain rows outside that graph are retained. Since withdrawals lack chainId, only wallet-based ETH withdrawals belonging to recipients of selected local allocations are eligible; ambiguous withdrawals or cross-network history stop the operation. Do not use this on a database shared by multiple networks.

## Restore

Keep Backend stopped. Verify the printed SHA-256 against the `.sha256` sidecar. Prefer restoring into a **separate empty local database** and inspecting it first; point Backend at it only after validation. With Compose, an operator can create that empty DB and stream the dump into it:

```sh
# Replace track_ai_restore with the chosen empty local DB name.
docker exec track-ai-mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -u root -e "CREATE DATABASE track_ai_restore"'
docker exec -i track-ai-mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -u root track_ai_restore' < .local-chain-backups/CHOSEN_BACKUP.sql
```

The dump does not create/change the target database name. Restoring the backup also restores the old chain identity and chain-dependent DB state. It does not restore an erased Hardhat node: restoring only SQL will correctly remain blocked against a different chain. Restore a matching EVM snapshot, or review and reconcile the restored DB against a fresh deployment. Files/IPFS were never deleted. Never restore directly over a live application DB.

## Tests

```sh
npm test
npm run test:local:chain:reconcile
```

The second command launches its own Hardhat process at 127.0.0.1:28545, deploys test artifacts into that process and creates/drops a disposable MySQL DB in local Compose. It refuses an occupied test RPC port. It does not use/reset the user's 8545 node, deployment manifest, accounts or five uploaded tracks. AI/IPFS responses and pre-existing contributor approval are explicitly test fixtures; EVM receipts, registration, ERC1155 mint, allocations, withdrawal, MySQL transactions and SQL backup/restore are real. Original `test:blockchain` remains available; `CHAIN_TEST_RPC_URL` and `BLOCKCHAIN_DEPLOYMENT_FILE` allow isolated fixtures.

## Verification result — 2026-11-04

Verification was performed on `fix/local-chain-reconciliation`, created from Backend `origin/main`, before any merge to main. No reset/migration of the existing development DB was performed.

- `npm test`: build succeeded; 68 passed, 0 failed, 4 pre-existing environment-gated integration tests skipped.
- `npm run test:local:chain:reconcile`: passed separately against an actually restarted Hardhat 3 process and disposable MySQL DB. This executes the blockchain E2E path skipped by the default suite.
- Same-chain restart preserved business state; queued retry counters are expected to increment without changing business data.
- Mismatch detection, read-only check/dry-run, missing confirmation, running Backend, failed SQL backup, injected mid-delete SQL error/rollback, actual SQL restore into another empty disposable DB and resumed sync all passed.
- Registration → purchase → ERC1155 license issuance → allocations → withdrawal passed both before and after recovery. AI/IPFS and accepted contributor approval are labeled fixtures; no real AI service was invoked.
- Five disposable audio tracks, file hashes, users/auth hashes/wallets, accepted contributor invitations, shares/finalization, AI evidence and metadata snapshots were preserved through reset.
- Independently read the existing development DB: its 5 original uploaded tracks and all 5 audio files still match their previously recorded SHA-256 hashes. Its 2 users remain; no test data was inserted there.
- `git diff --check` passed. Frontend and Contract worktrees were not changed.

Initial E2E failures and corrections: the old commerce test lacked the accepted contributor fixture now required by main; the preservation assertion included expected retry-attempt counter updates; Hardhat 3 does not implement `hardhat_reset`, so the isolated runner now really restarts its owned node through IPC; and the test HTTP server now rebinds its original ephemeral port on restart. These were corrected in test setup without weakening product authorization or data-preservation checks.
