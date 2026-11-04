const {ContractFactory,keccak256,HDNodeWallet}=require('ethers');
const fs=require('node:fs/promises'),path=require('node:path');
module.exports=async(provider,filename)=>{
 const names=['TrackRegistry','LicenseNFT','RevenueSplitter','LicenseMarketplace'];
 const signer=await provider.getSigner(0),owner=await signer.getAddress();
 const verifier=HDNodeWallet.fromPhrase('test test test test test test test test test test test junk',undefined,"m/44'/60'/0'/0/1").address;
 const contracts={},addresses={chainId:'31337',owner,verificationSigner:verifier};
 for(const name of names){
  const artifact=JSON.parse(await fs.readFile(path.resolve(__dirname,`../../../Contract/artifacts/contracts/${name}.sol/${name}.json`),'utf8'));
  const args=name==='TrackRegistry'?[verifier]:name==='LicenseMarketplace'?[addresses.TrackRegistry,addresses.LicenseNFT,addresses.RevenueSplitter,owner]:[addresses.TrackRegistry,owner];
  const contract=await new ContractFactory(artifact.abi,artifact.bytecode,signer).deploy(...args);await contract.waitForDeployment();contracts[name]=contract;addresses[name]=await contract.getAddress();
 }
 await(await contracts.LicenseNFT.setMarketplace(addresses.LicenseMarketplace)).wait();
 await(await contracts.RevenueSplitter.setMarketplace(addresses.LicenseMarketplace)).wait();
 const hashes={};for(const name of names)hashes[name]=keccak256(await provider.getCode(addresses[name]));
 const head=await provider.getBlock('latest'),genesis=await provider.getBlock(0);
 const manifest={...addresses,runtimeCodeHashes:hashes,genesisHash:genesis.hash,anchorBlock:head.number,anchorHash:head.hash};
 await fs.writeFile(filename,JSON.stringify(manifest));return manifest;
};
