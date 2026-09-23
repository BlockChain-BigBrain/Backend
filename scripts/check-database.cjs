require('dotenv/config');
const {PrismaClient} = require('@prisma/client');
const {errorSummary} = require('../dist/utils/errorLogger');
const db = new PrismaClient();
async function main() {
  const url = new URL(process.env.DATABASE_URL);
  console.log(JSON.stringify({event:'database_config', protocol:url.protocol, loopback:['localhost','127.0.0.1','[::1]'].includes(url.hostname)}));
  for (const [stage,run] of [
    ['connectivity',()=>db.$queryRaw`SELECT 1`],
    ['track_schema',()=>db.track.findMany({take:1,select:{id:true}})],
    ['auth_schema',()=>db.user.findMany({take:1,select:{id:true,provider:true,passwordHash:true,refreshTokenHash:true,preferredLanguage:true}})],
    ['track_relations',()=>db.track.findMany({take:1,include:{owner:{select:{id:true,name:true,profileImage:true}},contributions:true}})],
  ]) {
    try {await run();console.log(JSON.stringify({stage,status:'ok'}));}
    catch(error) {console.error(JSON.stringify({stage,status:'failed',...errorSummary(error)}));process.exitCode=1;break;}
  }
}
main().catch(error=>{console.error(JSON.stringify(errorSummary(error)));process.exitCode=1;}).finally(()=>db.$disconnect());
