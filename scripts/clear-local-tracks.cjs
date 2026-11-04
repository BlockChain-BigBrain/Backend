/**
 * LOCAL DEV ONLY. Dry-run by default. Does not remove audio files, IPFS content,
 * on-chain state, users, wallet challenges, or blockchain sync identity/cursors.
 *
 * Run using the SAME DATABASE_URL as Prisma Studio:
 *   node --env-file=.env.services.local scripts/clear-local-tracks.cjs
 * Back up MySQL with mysqldump first, then:
 *   node --env-file=.env.services.local scripts/clear-local-tracks.cjs --confirm=DELETE_ALL_LOCAL_TRACKS --backup=/absolute/path/to/backup.sql
 */
const { PrismaClient } = require('@prisma/client')
const fs = require('node:fs')
const path = require('node:path')

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw Error('DATABASE_URL is missing')
  const db = new URL(url)
  if (!['127.0.0.1', 'localhost', '::1'].includes(db.hostname)) {
    throw Error('Refusing non-loopback DATABASE_URL')
  }
  const prisma = new PrismaClient()
  try {
    const counts = {}
    for (const [name, model] of Object.entries({
      tracks: prisma.track, verifications: prisma.verification,
      similarities: prisma.similarityResult, contributions: prisma.contribution,
      invitations: prisma.contributionInvitation, metadata: prisma.metadataSnapshot,
      registrations: prisma.registrationRequest, listings: prisma.marketplaceListing,
      purchases: prisma.purchaseRequest, licenses: prisma.license,
      transactions: prisma.transaction, allocations: prisma.revenueAllocation,
    })) counts[name] = await model.count()
    const tracks = await prisma.track.findMany({ select: {
      id: true, title: true, audioPath: true, registrationStatus: true,
      registrationTxHash: true, audioCid: true, metadataCid: true,
    }, orderBy: { id: 'asc' } })
    console.log(JSON.stringify({ mode: 'preview', database: db.pathname,
      counts, tracks, note: 'Audio files, IPFS, blockchain history and sync cursor are NOT deleted.' }, null, 2))
    const confirmed = process.argv.includes('--confirm=DELETE_ALL_LOCAL_TRACKS')
    if (!confirmed) return
    const backupArg = process.argv.find(a => a.startsWith('--backup='))
    const backup = backupArg?.slice('--backup='.length)
    if (!backup || !path.isAbsolute(backup) || !fs.existsSync(backup) || !fs.statSync(backup).isFile() || fs.statSync(backup).size < 100) {
      throw Error('A pre-existing nonempty absolute-path MySQL .sql backup is required: --backup=/absolute/path/backup.sql')
    }
    // Do not silently erase any historical purchase, settlement, or license.
    if (counts.purchases || counts.licenses || counts.transactions || counts.allocations) {
      throw Error('Financial/rights records exist; refusing destructive cleanup')
    }
    // Prevent accidental cleanup of another database or changed dataset.
    if (!process.argv.includes('--expect-tracks=' + counts.tracks)) {
      throw Error('Pass --expect-tracks=' + counts.tracks + ' after reviewing preview and backup')
    }
    await prisma.$transaction(async tx => {
      // Registration requests can restrict metadata snapshots.
      await tx.registrationRequest.deleteMany({})
      await tx.metadataSnapshot.deleteMany({})
      await tx.marketplaceListing.deleteMany({})
      await tx.similarityResult.deleteMany({})
      await tx.verification.deleteMany({})
      await tx.contributionInvitation.deleteMany({})
      await tx.contribution.deleteMany({})
      await tx.track.deleteMany({})
    }, { timeout: 120000 })
    console.log('Local track rows cleared. Preserve backup. Chain cursor/identity and physical audio files were NOT changed.')
  } finally { await prisma.$disconnect() }
}
main().catch(e => { console.error(e.message || e); process.exitCode = 1 })
