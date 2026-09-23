const {test} = require('node:test');
const assert = require('node:assert/strict');
const {errorSummary, logServerError} = require('../dist/utils/errorLogger');

test('classifies Prisma initialization and schema errors without exposing details', () => {
  assert.equal(errorSummary({errorCode:'P1001'}).reason, 'database_unreachable');
  assert.equal(errorSummary({code:'P2021'}).reason, 'database_table_missing');
  const secret = 'private-credential-value';
  const error = {name:'PrismaClientInitializationError', errorCode:'P1000', message:secret, stack:secret, meta:{password:secret}, config:{data:secret}};
  assert.equal(JSON.stringify(errorSummary(error)).includes(secret), false);
  assert.equal(errorSummary(error).reason, 'database_authentication_failed');
  assert.deepEqual(errorSummary({name:secret,code:secret,message:secret}), {type:'Error',code:undefined,reason:'unclassified_error'});
});

test('logs only the event and allowlisted diagnostic fields', () => {
  const previous = console.error; const lines = [];
  console.error = value => lines.push(value);
  try { logServerError('google_login_failed', {code:'P2022', request:{cookie:'secret'}, response:{data:'secret'}}); }
  finally { console.error = previous; }
  assert.deepEqual(JSON.parse(lines[0]), {event:'google_login_failed',type:'Error',code:'P2022',reason:'database_column_missing'});
});

test('initialization failures without Prisma codes are classified without disclosing messages', () => {
  for (const [message, reason] of [
    ["Can't reach database server at private-host:3306", 'database_unreachable'],
    ['Authentication failed for private-user', 'database_authentication_failed'],
    ['Unable to load libquery_engine for private-path', 'database_engine_runtime_error'],
    ['TLS certificate error for private-host', 'database_tls_error'],
  ]) {
    const result = errorSummary({name:'PrismaClientInitializationError',message});
    assert.equal(result.reason,reason);
    assert.equal(JSON.stringify(result).includes('private-'),false);
  }
});

test('database configuration summary does not expose host, credentials or database name', () => {
  const {databaseConfigSummary} = require('../dist/utils/errorLogger');
  const result = databaseConfigSummary('mysql://private-user:private-password@localhost:3306/private-database');
  assert.equal(result.loopback,true);assert.equal(result.mysql,true);
  assert.equal(JSON.stringify(result).includes('private-'),false);
  assert.equal(databaseConfigSummary('mysql://u:p@remote.example/db').loopback,false);
  assert.equal(databaseConfigSummary('invalid').validUrl,false);
  assert.equal(databaseConfigSummary(undefined).configured,false);
});
