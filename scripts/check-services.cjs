require('dotenv').config({path:'.env.services.local',quiet:true});
require('../dist/config');
const {chainClient}=require('../dist/blockchain/client');
const {PrismaClient}=require('@prisma/client');
const db=new PrismaClient();
(async()=>{let failures=0;
 const checks=[['mysql',async()=>{await db.$queryRaw`SELECT 1`;await db.verification.findFirst({select:{evidence:true}});}],['ai',async()=>{const r=await fetch((process.env.AI_API_URL||'http://127.0.0.1:8000')+'/health',{signal:AbortSignal.timeout(10000)});if(!r.ok||(await r.json()).status!=='ready')throw Error();}],['ipfs',async()=>{const r=await fetch((process.env.IPFS_API_URL||'http://127.0.0.1:5001')+'/api/v0/version',{method:'POST',signal:AbortSignal.timeout(10000)});if(!r.ok||!(await r.json()).Version)throw Error();}],['blockchain',async()=>{const result=await chainClient.health();if(!result.connected)throw Error();}]];
 for(const [name,check]of checks){try{await check();console.log(`${name}: READY`);}catch{failures++;console.log(`${name}: NOT READY`);}}
 await db.$disconnect();await chainClient.provider.destroy();process.exitCode=failures?1:0;
})().catch(()=>{console.error('Service check failed');process.exitCode=1;});
