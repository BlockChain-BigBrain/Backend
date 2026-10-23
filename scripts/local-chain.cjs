const {spawn,spawnSync}=require('node:child_process');
const path=require('node:path');
const {JsonRpcProvider,HDNodeWallet}=require('ethers');
const root=path.resolve(__dirname,'..'),contract=path.resolve(root,'../Contract');
const verifier=HDNodeWallet.fromPhrase('test test test test test test test test test test test junk',undefined,"m/44'/60'/0'/0/1");
const npm=process.platform==='win32'?'npm.cmd':'npm';
let node;
const provider=new JsonRpcProvider('http://127.0.0.1:8545');
let stopping=false;
const stop=()=>{if(stopping)return;stopping=true;node?.kill();void provider.destroy();};
process.on('SIGINT',stop);process.on('SIGTERM',stop);

function run(cmd,args,cwd,env=process.env){const result=spawnSync(cmd,args,{cwd,env,stdio:'inherit'});if(result.error||result.status!==0)throw Error('Local chain setup failed');}
(async()=>{
 let occupied=false;
 try { await provider.getNetwork(); occupied=true; } catch {}
 if(occupied) throw Error('RPC port 8545 is already in use. Stop the previous local node first.');
 node=spawn(npm,['exec','--','hardhat','node','--hostname','127.0.0.1'],{cwd:contract,stdio:'inherit'});
 node.on('error',error=>{console.error(error.message);process.exitCode=1;stop();});
 node.on('exit',code=>{stop();process.exitCode=code||0;});
 let ready=false;
 for(let i=0;i<30;i++){if(node.exitCode!==null)throw Error('Hardhat node exited');try{await provider.getNetwork();ready=true;break;}catch{await new Promise(r=>setTimeout(r,500));}}
 if(!ready)throw Error('Hardhat node did not start');
 run(npm,['exec','--','hardhat','run','scripts/deploy.ts','--network','localhost'],contract,{...process.env,VERIFICATION_SIGNER_ADDRESS:verifier.address});
 run(process.execPath,['scripts/import-contract.cjs',contract],root);
 run(process.execPath,['scripts/setup-hardhat-env.cjs'],root);
 // Local auto-mining creates one block per transaction; one confirmation avoids
 // waiting indefinitely for a second block when no later transaction is sent.
 const fs=require('node:fs'),file=path.join(root,'.env.blockchain.local');
 fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('BLOCKCHAIN_CONFIRMATIONS=2','BLOCKCHAIN_CONFIRMATIONS=1'),{mode:0o600});
 console.log('Local contracts imported. Keep this terminal open. Restart Backend after restarting this node.');
 await provider.destroy();
})().catch(error=>{console.error(error.message);process.exitCode=1;stop();});
