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

test('AI config uses canonical variables and preloaded service env takes precedence over .env',()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'track-ai-config-'));
  try {
    fs.writeFileSync(path.join(root,'.env'),'AI_API_URL=https://default.invalid\nTRACK_AI_API_KEY=default-fixture-key\n');
    const services=path.join(root,'.env.services.local');
    fs.writeFileSync(services,'AI_API_URL=https://service.invalid\nTRACK_AI_API_KEY=service-fixture-key\n');
    const script=`const {config}=require(${JSON.stringify(path.resolve(__dirname,'../dist/config'))});console.log(JSON.stringify({url:config.aiUrl,key:config.aiApiKey}));`;
    const env={...process.env};
    for(const key of ['AI_API_URL','TRACK_AI_API_KEY','AI_BASE_URL','AI_API_TOKEN','DOTENV_CONFIG_PATH','BLOCKCHAIN_ENV_FILE']) delete env[key];
    const run=(args,extra={})=>JSON.parse(execFileSync(process.execPath,[...args,'-e',script],{cwd:root,env:{...env,...extra},encoding:'utf8'}));
    assert.deepEqual(run([]),{url:'https://default.invalid',key:'default-fixture-key'});
    assert.deepEqual(run([`--env-file=${services}`]),{url:'https://service.invalid',key:'service-fixture-key'});
    assert.deepEqual(run([`--env-file=${services}`],{TRACK_AI_API_KEY:'process-fixture-key'}),{url:'https://service.invalid',key:'process-fixture-key'});
    assert.deepEqual(run([],{AI_API_URL:'https://canonical.invalid',TRACK_AI_API_KEY:'',AI_BASE_URL:'https://ignored.invalid',AI_API_TOKEN:'ignored-fixture-key'}),{url:'https://canonical.invalid',key:''});
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
