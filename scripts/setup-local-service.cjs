const fs=require('node:fs');
const {randomBytes}=require('node:crypto');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const target=path.join(root,'.env.services.local');
if(fs.existsSync(target)) { console.log('.env.services.local already exists; existing settings preserved.'); process.exit(0); }
const secret=()=>randomBytes(32).toString('hex');
const mysql=secret(), values={NODE_ENV:'development',PORT:'4000',FRONTEND_URL:'http://localhost:8443',DATABASE_URL:`mysql://track_ai:${mysql}@127.0.0.1:33306/track_ai`,MYSQL_PASSWORD:mysql,MYSQL_ROOT_PASSWORD:secret(),JWT_ACCESS_SECRET:secret(),JWT_REFRESH_SECRET:secret(),COOKIE_SECURE:'false',AI_PROVIDER_MODE:'http',AI_API_URL:'http://127.0.0.1:8000',TRACK_AI_API_KEY:secret(),VERIFICATION_TIMEOUT_MS:'600000',STORAGE_PROVIDER_MODE:'kubo',IPFS_API_URL:'http://127.0.0.1:5001',PAYMENT_PROVIDER_MODE:'unconfigured',BLOCKCHAIN_ENV_FILE:'.env.blockchain.local'};
fs.writeFileSync(target,Object.entries(values).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{flag:'wx',mode:0o600});
console.log('Created .env.services.local. Set the same TRACK_AI_API_KEY in AI/.env; do not commit either file.');
