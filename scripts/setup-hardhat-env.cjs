// Public Hardhat development mnemonic only. Never use this wallet on external networks.
const fs=require('node:fs');
const {HDNodeWallet,Wallet}=require('ethers');
const {parse}=require('dotenv');
const deployment=JSON.parse(fs.readFileSync('src/blockchain/deployment.json','utf8'));
if(deployment.chainId!=='31337') throw Error('Local chain only');
const contractEnv=process.argv[2]?parse(fs.readFileSync(process.argv[2],'utf8')):null;
const wallet=contractEnv?new Wallet(contractEnv.VERIFICATION_SIGNER_PRIVATE_KEY):HDNodeWallet.fromPhrase('test test test test test test test test test test test junk',undefined,"m/44'/60'/0'/0/1");
if(contractEnv && wallet.address.toLowerCase()!==contractEnv.VERIFICATION_SIGNER_ADDRESS?.toLowerCase()) throw Error('Contract verifier key/address mismatch');
if(wallet.address.toLowerCase()!==deployment.verificationSigner.toLowerCase()) throw Error('Deployment verifier does not match selected key; redeploy locally first');
const values={BLOCKCHAIN_NETWORK:'hardhat',BLOCKCHAIN_RPC_URL:'http://127.0.0.1:8545',BLOCKCHAIN_CHAIN_ID:'31337',TRACK_REGISTRY_ADDRESS:deployment.TrackRegistry,LICENSE_NFT_ADDRESS:deployment.LicenseNFT,LICENSE_MARKETPLACE_ADDRESS:deployment.LicenseMarketplace,REVENUE_SPLITTER_ADDRESS:deployment.RevenueSplitter,VERIFICATION_SIGNER_ADDRESS:wallet.address,VERIFICATION_SIGNER_PRIVATE_KEY:wallet.privateKey,EIP712_DOMAIN_NAME:'TrackAI_Registry',EIP712_DOMAIN_VERSION:'1',EIP712_PRIMARY_TYPE:'RegisterTrack',EIP712_FIELD_ORDER:'audioHash,metadataCIDHash,registrant,contributorsHash,similarityScore,modelVersion,nonce,deadline',EIP712_FIELD_TYPES_JSON:'{}',EIP712_HASHING_JSON:'{}',BLOCKCHAIN_CONFIRMATIONS:'2'};
fs.writeFileSync('.env.blockchain.local','# LOCAL HARDHAT verifier configuration; never commit this file\n'+Object.entries(values).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});
fs.chmodSync('.env.blockchain.local',0o600);
console.log('Created ignored .env.blockchain.local; existing .env and DB configuration preserved.');
