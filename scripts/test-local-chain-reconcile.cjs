// Isolated EVM on 28545 and disposable MySQL database; never resets the user's node/DB.
const {spawn}=require('node:child_process'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {JsonRpcProvider}=require('ethers');
require('dotenv').config({path:'.env.services.local',quiet:true});
(async()=>{
 const rpc='http://127.0.0.1:28545';
 const provider=new JsonRpcProvider(rpc,undefined,{cacheTimeout:-1});
 let child,root;
 try{
  // Refuse to reset any pre-existing node at the test port.
  const occupied=await fetch(rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]}),signal:AbortSignal.timeout(1000)}).then(()=>true,()=>false);
  if(occupied)throw Error('Test RPC port 28545 already in use');
  root=await fs.mkdtemp(path.join(os.tmpdir(),'track-reconcile-e2e-'));
  async function startNode(){
   child=spawn(process.platform==='win32'?'npm.cmd':'npm',['exec','--','hardhat','node','--hostname','127.0.0.1','--port','28545'],{cwd:path.resolve('../Contract'),stdio:['ignore','ignore','pipe'],detached:process.platform!=='win32'});
  child.stderr.resume();child.on('error',()=>{});
  let ready=false;
  for(let i=0;i<80;i++){
   if(child.exitCode!==null)throw Error('Isolated Hardhat node exited');
   try{await provider.getNetwork();ready=true;break;}catch{await new Promise(r=>setTimeout(r,250));}
  }
  if(!ready)throw Error('Isolated Hardhat did not start');
  }
  async function stopNode(){
   const previous=child;if(!previous?.pid)return;
   const closed=new Promise(resolve=>previous.once('close',resolve));
   try{process.kill(-previous.pid,'SIGTERM')}catch{previous.kill()}
   await closed;child=undefined;
  }
  await startNode();
  const manifest=path.join(root,'deployment.json');await require('../tests/helpers/deploy-local-fixture.cjs')(provider,manifest);
  const env={...process.env,BLOCKCHAIN_ENV_FILE:'',BLOCKCHAIN_DEPLOYMENT_FILE:manifest,CHAIN_TEST_RPC_URL:rpc,CHAIN_TEST:'1',CHAIN_RECONCILE_TEST:'1',SCHEMA_TEST_MYSQL_SOCKET:'/var/run/mysqld/mysqld.sock',SCHEMA_TEST_MYSQL_BIN:path.resolve('scripts/mysql-local-test.sh'),SCHEMA_TEST_DATABASE_URL:`mysql://root:${encodeURIComponent(process.env.MYSQL_ROOT_PASSWORD)}@127.0.0.1:33306/track_ai_test`,LOCAL_CHAIN_BACKUP_CONTAINER:'track-ai-mysql',LOCAL_CHAIN_BACKUP_DIR:path.join(root,'backups')};
  const test=spawn(process.execPath,['--test','--test-isolation=none','tests/blockchain-e2e.test.cjs'],{env,stdio:['inherit','inherit','inherit','ipc']});
  test.on('message',async message=>{
   if(message?.type!=='restart-isolated-hardhat')return;
   try{await stopNode();await startNode();test.send({type:'isolated-hardhat-restarted'});}
   catch{test.send({type:'isolated-hardhat-restart-failed'});}
  });
  const code=await new Promise((resolve,reject)=>{test.once('error',reject);test.once('close',resolve)});process.exitCode=code??1;
 }finally{
  if(child?.pid){try{process.kill(-child.pid,'SIGTERM')}catch{child.kill()}}
  await provider.destroy();if(root)await fs.rm(root,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error.message);process.exitCode=1});
