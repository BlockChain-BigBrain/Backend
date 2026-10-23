const fs=require('node:fs'),path=require('node:path');
fs.mkdirSync('dist/blockchain/abi',{recursive:true});
for(const name of ['TrackRegistry','LicenseNFT','LicenseMarketplace','RevenueSplitter']) fs.copyFileSync(`src/blockchain/abi/${name}.json`,`dist/blockchain/abi/${name}.json`);
if(fs.existsSync('src/blockchain/deployment.json')) fs.copyFileSync('src/blockchain/deployment.json','dist/blockchain/deployment.json');
