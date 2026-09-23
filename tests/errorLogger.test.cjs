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
