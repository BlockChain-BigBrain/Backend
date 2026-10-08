const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const {readFileSync,readdirSync} = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {execFileSync} = require('node:child_process');
const {PrismaClient} = require('@prisma/client');
const {TrackRepository} = require('../dist/repositories/track.repository');
const {TrackService} = require('../dist/services/track.service');
const {TrackFiles} = require('../dist/utils/trackFiles');
const {upload} = require('./helpers/track-fixtures.cjs');
const socket = process.env.SCHEMA_TEST_MYSQL_SOCKET;

test('real MySQL track CRUD preserves files on FK failure and serializes registration/deletion', {skip:!socket}, async () => {
  const database=`track_management_test_${process.pid}`;
  const mysql=process.env.SCHEMA_TEST_MYSQL_BIN || 'mysql';
  const sql=(statement,useDatabase=true)=>execFileSync(mysql,['--no-defaults',`--socket=${socket}`,'-u','root','--batch','--skip-column-names',...(useDatabase?[database]:[])],{input:statement,encoding:'utf8',stdio:['pipe','pipe','pipe']});
  sql(`CREATE DATABASE \`${database}\`;`,false);
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'track-management-db-'));
  // Explicit disposable socket; never connect via the user's DATABASE_URL.
  const db=new PrismaClient({datasourceUrl:`mysql://root@localhost/${database}?socket=${encodeURIComponent(socket)}`});
  try {
    const migrations=path.resolve(__dirname,'../prisma/migrations');
    for(const folder of readdirSync(migrations).filter(name=>/^\d/.test(name)).sort()) sql(readFileSync(path.join(migrations,folder,'migration.sql'),'utf8'));
    const creator=await db.user.create({data:{email:'creator@example.test',name:'Creator',provider:'LOCAL'}});
    const other=await db.user.create({data:{email:'buyer@example.test',name:'Buyer',provider:'LOCAL'}});
    const files=new TrackFiles(root,1000), service=new TrackService(new TrackRepository(db),db,files);
    const file=await upload(root);
    const track=await service.create(creator.id,{title:'Original',isPublic:false,contributors:[{userId:creator.id,role:'COMPOSER',percentage:60},{userId:other.id,role:'PRODUCER',percentage:40}]},file);
    assert.equal(track.fileSize,'52'); assert.equal(track.contributions.length,2);
    assert.equal((await db.track.findUnique({where:{id:track.id}})).fileSize,52n);
    assert.equal((await service.list({})).total,0);
    assert.equal((await service.list({scope:'mine'},creator.id)).total,1);
    await assert.rejects(service.get(track.id,other.id),{statusCode:404});
    await assert.rejects(service.update(track.id,other.id,{title:'Stolen'}),{statusCode:403});
    const playable=await service.audio(track.id,creator.id); assert.equal(playable.size,52); await playable.handle.close();
    await service.update(track.id,creator.id,{title:'Public Original',isPublic:true,prompt:'Secret'});
    assert.equal((await service.list({search:'Original',sort:'title',order:'asc',limit:'1'})).total,1);
    assert.equal((await service.get(track.id)).prompt,null);
    // Hold the registration row lock, then queue an edit. The edit must observe PENDING after commit.
    let markStarted, release;
    const started=new Promise(resolve=>{markStarted=resolve;});
    const gate=new Promise(resolve=>{release=resolve;});
    const registration=db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM Track WHERE id = ${track.id} FOR UPDATE`;
      await tx.track.update({where:{id:track.id},data:{registrationStatus:'PENDING'}});
      markStarted(); await gate;
    });
    await started;
    const edit=service.update(track.id,creator.id,{title:'Should not change'});
    const rejected=assert.rejects(edit,{statusCode:409});
    release(); await registration; await rejected;
    assert.equal((await db.track.findUnique({where:{id:track.id}})).title,'Public Original');
    await db.track.update({where:{id:track.id},data:{registrationStatus:'NOT_REGISTERED'}});
    const license=await db.license.create({data:{trackId:track.id,buyerId:other.id,type:'COMMERCIAL',price:'1',currency:'USD'}});
    await assert.rejects(service.remove(track.id,creator.id),{statusCode:409});
    assert.equal((await fs.readFile(file.path)).length,52);
    assert.equal(await db.track.count({where:{id:track.id}}),1);
    assert.ok(!(await fs.readdir(root)).some(name=>name.startsWith('.delete-')));
    await db.license.delete({where:{id:license.id}});
    const deletions=await Promise.allSettled([service.remove(track.id,creator.id),service.remove(track.id,creator.id)]);
    assert.equal(deletions.filter(result=>result.status==='fulfilled').length,1);
    assert.equal(deletions.find(result=>result.status==='rejected').reason.statusCode,404);
    await assert.rejects(fs.stat(file.path),{code:'ENOENT'});
    assert.equal(await db.contribution.count({where:{trackId:track.id}}),0);
    assert.deepEqual(await fs.readdir(root),[]);
    const output=execFileSync(process.execPath,['scripts/test-local-flow.cjs'],{
      cwd:path.resolve(__dirname,'..'),encoding:'utf8',timeout:30000,
      env:{...process.env,DATABASE_URL:`mysql://root@localhost/${database}?socket=${encodeURIComponent(socket)}`,NODE_ENV:'development',MAX_UPLOAD_MB:'50',JWT_ACCESS_SECRET:'isolated-local-access-secret',JWT_REFRESH_SECRET:'isolated-local-refresh-secret'},
    });
    assert.match(output,/PASS signup using real local MySQL/);
    assert.match(output,/PASS authenticated multipart WAV upload, file storage and playback URL/);
    assert.match(output,/PASS session refresh, logout and revoked-session rejection/);
  } finally {
    await db.$disconnect();
    sql(`DROP DATABASE \`${database}\`;`,false);
    await fs.rm(root,{recursive:true,force:true});
  }
});
