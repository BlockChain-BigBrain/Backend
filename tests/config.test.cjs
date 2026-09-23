const {test}=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
test('production forces secure cookies while HTTP development can disable them',()=>{
  for(const [nodeEnv,secure,expected] of [['production','false',true],['development','false',false],['development','true',true]]) {
    const output=execFileSync(process.execPath,['-e',"console.log(JSON.stringify(require('./dist/config').config.cookieSecure))"],{
      cwd:require('node:path').resolve(__dirname,'..'),env:{...process.env,NODE_ENV:nodeEnv,COOKIE_SECURE:secure},encoding:'utf8',
    });
    assert.equal(JSON.parse(output),expected);
  }
});
