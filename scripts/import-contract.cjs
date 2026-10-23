// Import public artifacts only. No .env or private key is copied.
const fs = require('node:fs/promises');
const path = require('node:path');
const { JsonRpcProvider, Interface, isAddress, keccak256 } = require('ethers');
(async () => {
 const root = path.resolve(process.argv[2] || '../Contract');
 const url = process.argv[3] || 'http://127.0.0.1:8545';
 const u = new URL(url);
 if (!['localhost','127.0.0.1','[::1]'].includes(u.hostname) || u.protocol !== 'http:') throw Error('Local RPC only');
 const provider = new JsonRpcProvider(url, undefined, {cacheTimeout:-1});
 const deployment = JSON.parse(await fs.readFile(path.join(root,'deployments/31337.json'),'utf8'));
 if ((await provider.getNetwork()).chainId !== 31337n || deployment.chainId !== '31337') throw Error('Chain mismatch');
 const names = ['TrackRegistry','LicenseNFT','LicenseMarketplace','RevenueSplitter'];
 const abis = {}, hashes = {};
 for (const name of names) {
  if (!isAddress(deployment[name])) throw Error('Invalid '+name+' address');
  abis[name] = JSON.parse(await fs.readFile(path.join(root,'abi',name+'.json'),'utf8'));
  new Interface(abis[name]);
  const code = await provider.getCode(deployment[name]);
  if (code === '0x') throw Error('No deployed code: '+name+'; deploy to persistent localhost node first');
  hashes[name] = keccak256(code);
 }
 const block = await provider.getBlock('latest'), genesis = await provider.getBlock(0);
 const manifest = {...deployment,runtimeCodeHashes:hashes,anchorBlock:block.number,anchorHash:block.hash,genesisHash:genesis.hash};
 await fs.mkdir('src/blockchain/abi',{recursive:true});
 for(const name of names) await fs.writeFile('src/blockchain/abi/'+name+'.json',JSON.stringify(abis[name],null,2)+'\n');
 await fs.writeFile('src/blockchain/deployment.json',JSON.stringify(manifest,null,2)+'\n');
 console.log('Imported local deployment and runtime code hashes; set addresses in Backend .env.');
 await provider.destroy();
})().catch(e=>{console.error(e.message);process.exitCode=1;});
