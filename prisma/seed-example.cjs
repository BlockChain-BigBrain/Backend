require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const db = new PrismaClient();

async function main() {
  const url = new URL(process.env.DATABASE_URL);
  if (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('This public example account is only for a local development database.');
  }
  const email = 'fan@example.com';
  const password = 'password123';
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.provider !== 'LOCAL' || !existing.passwordHash || !await bcrypt.compare(password, existing.passwordHash)) {
      throw new Error('An existing account has different credentials; it was not modified.');
    }
    console.log('Example account already exists: ' + email);
    return;
  }
  await db.user.create({ data: {
    email, name: '음악팬', provider: 'LOCAL', preferredLanguage: 'ko',
    passwordHash: await bcrypt.hash(password, 12),
  } });
  console.log('Example account created: ' + email);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
