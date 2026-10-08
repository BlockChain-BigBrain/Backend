const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');

// Only an explicitly supplied disposable MySQL socket is used; never DATABASE_URL.
const socket = process.env.SCHEMA_TEST_MYSQL_SOCKET;
test('migrations preserve legacy records and enforce new integrity rules', { skip: !socket }, () => {
  const mysql = process.env.SCHEMA_TEST_MYSQL_BIN || 'mysql';
  const database = `track_ai_schema_test_${process.pid}`;
  function sql(statement, useDatabase = true) {
    return execFileSync(mysql, ['--no-defaults', `--socket=${socket}`, '-u', 'root', '--batch', '--skip-column-names', ...(useDatabase ? [database] : [])], {
      input: statement, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  }
  function rejects(statement, code) {
    assert.throws(() => sql(statement), error => error.stderr.includes(`ERROR ${code}`));
  }
  sql(`CREATE DATABASE \`${database}\`;`, false);
  try {
    const migrations = path.resolve(__dirname, '../prisma/migrations');
    const folders = readdirSync(migrations).filter(name => /^\d/.test(name)).sort();
    for (const folder of folders.filter(name => name < '20261008100000')) {
      sql(readFileSync(path.join(migrations, folder, 'migration.sql'), 'utf8'));
    }
    sql(`INSERT INTO User (id,email,name,provider,passwordHash,refreshTokenHash,updatedAt) VALUES (1,'legacy@example.test','Legacy','LOCAL','preserved-password','preserved-refresh',NOW());
      INSERT INTO Track (id,title,audioPath,mimeType,ownerId,updatedAt) VALUES (1,'Legacy track','/uploads/legacy.wav','audio/wav',1,NOW());
      INSERT INTO Contribution (trackId,userId,role,percentage) VALUES (1,1,'COMPOSER',100);
      INSERT INTO Verification (id,trackId,status,updatedAt) VALUES (1,1,'VERIFIED',NOW());
      INSERT INTO SimilarityResult (trackId,score) VALUES (1,0.72);
      INSERT INTO License (id,trackId,buyerId,type,price) VALUES (1,1,1,'COMMERCIAL',9999999999.99);
      INSERT INTO Transaction (id,trackId,userId,licenseId,amount,status) VALUES (1,1,1,1,9999999999.99,'COMPLETED');`);
    for (const folder of folders.filter(name => name >= '20261008100000')) {
      sql(readFileSync(path.join(migrations, folder, 'migration.sql'), 'utf8'));
    }
    assert.equal(sql('SELECT passwordHash,refreshTokenHash FROM User WHERE id=1'), 'preserved-password\tpreserved-refresh');
    assert.equal(sql('SELECT registrationStatus,audioHash IS NULL FROM Track WHERE id=1'), 'NOT_REGISTERED\t1');
    assert.equal(sql('SELECT status,source,riskScore IS NULL FROM Verification WHERE id=1'), 'VERIFIED\tUNCONFIGURED\t1');
    assert.equal(sql('SELECT verificationId IS NULL,comparedTrackId IS NULL FROM SimilarityResult'), '1\t1');
    assert.equal(sql('SELECT price,currency,licenseStatus FROM License'), '9999999999.990000000000000000\tUNKNOWN\tPENDING_PAYMENT');
    assert.equal(sql('SELECT amount,status,currency FROM Transaction'), '9999999999.990000000000000000\tCOMPLETED\tUNKNOWN');
    const listing = (status, active) => `INSERT INTO MarketplaceListing (trackId,sellerId,price,currency,status,activeTrackId,updatedAt) VALUES (1,1,1,'USD','${status}',${active},NOW())`;
    sql(listing('PREPARING', 'NULL'));
    sql(listing('PREPARING', 'NULL'));
    sql(listing('ACTIVE', 1));
    rejects(listing('ACTIVE', 1), 1062);
    rejects(listing('ACTIVE', 'NULL'), 3819);
    rejects(listing('ACTIVE', 2), 3819);
    rejects(listing('PREPARING', 1), 3819);
    rejects("INSERT INTO MarketplaceListing (trackId,sellerId,price,currency,updatedAt) VALUES (1,1,0,'USD',NOW())", 3819);
    rejects("INSERT INTO MarketplaceListing (trackId,sellerId,price,currency,updatedAt) VALUES (1,1,1,'UNKNOWN',NOW())", 3819);
    rejects('UPDATE Verification SET riskScore=1.1 WHERE id=1', 3819);
    sql("INSERT INTO RevenueAllocation (transactionId,userId,percentage,amount,currency) VALUES (1,1,100,1.000000000000000001,'ETH')");
    assert.equal(sql('SELECT amount,confirmedAt IS NULL FROM RevenueAllocation'), '1.000000000000000001\t1');
    rejects("INSERT INTO RevenueAllocation (transactionId,userId,percentage,amount,currency) VALUES (1,1,100,1,'ETH')", 1062);
    rejects('DELETE FROM Transaction WHERE id=1', 1451);
    rejects('DELETE FROM Track WHERE id=1', 1451);
    sql('UPDATE SimilarityResult SET verificationId=1,comparedTrackId=1; DELETE FROM Verification WHERE id=1;');
    assert.equal(sql('SELECT verificationId IS NULL FROM SimilarityResult'), '1');
    sql("INSERT INTO Transaction (trackId,userId,amount,paymentReference) VALUES (1,1,1,'unique-payment')");
    rejects("INSERT INTO Transaction (trackId,userId,amount,paymentReference) VALUES (1,1,1,'unique-payment')", 1062);
    sql("INSERT INTO RevenueWithdrawal (userId,amount,currency,updatedAt) VALUES (1,1,'USD',NOW())");
    assert.equal(sql('SELECT status,confirmedAt IS NULL,txHash IS NULL FROM RevenueWithdrawal'), 'PREPARING\t1\t1');
    rejects("INSERT INTO RevenueWithdrawal (userId,amount,currency,updatedAt) VALUES (1,-1,'USD',NOW())", 3819);
  } finally {
    sql(`DROP DATABASE \`${database}\`;`, false);
  }
});
