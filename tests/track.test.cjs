const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = fsSync.mkdtempSync(path.join(os.tmpdir(), 'track-management-unit-'));
process.env.UPLOAD_DIR = root;
process.env.MAX_UPLOAD_MB = '0.001';
process.env.JWT_ACCESS_SECRET = 'track-tests-secret';
const { TrackService } = require('../dist/services/track.service');
const { TrackFiles } = require('../dist/utils/trackFiles');
const { detectAudio } = require('../dist/utils/audioFile');
const { parseCreateTrack, parseUpdateTrack, parseTrackList, trackId } = require('../dist/dto/track.dto');
const { wav, mp3, upload, record, repository } = require('./helpers/track-fixtures.cjs');
after(() => fs.rm(root, { recursive: true, force: true }));
async function fixture(t, directory) {
  const dir = directory ?? await fs.mkdtemp(path.join(root, 'files-'));
  const files = new TrackFiles(dir, 1000), repo = repository();
  const db = { user: { count: async ({where}) => where.id.in.length } };
  const service = new TrackService(repo, db, files);
  return { dir, files, repo, db, service };
}
test('MP3/WAV structural validation rejects spoofed, truncated and malformed audio', () => {
  assert.equal(detectAudio(wav()), 'audio/wav'); assert.equal(detectAudio(mp3()), 'audio/mpeg');
  const badWav = wav(); badWav.writeUInt32LE(9999, 40);
  const badFmt = wav(); badFmt.writeUInt16LE(7, 20);
  const emptyData = wav(); emptyData.writeUInt32LE(0, 40);
  const badMp3 = mp3(); badMp3[417] = 0;
  for (const buffer of [Buffer.alloc(0), Buffer.from('<html>fake audio</html>'), Buffer.from('ID3'), Buffer.from('RIFFfakeWAVE'), badWav, badFmt, emptyData, wav().subarray(0,51), mp3().subarray(0,420), badMp3]) {
    assert.throws(() => detectAudio(buffer), { statusCode: 415 });
  }
  const id3 = Buffer.alloc(10); id3.write('ID3'); id3[3]=4;
  assert.equal(detectAudio(Buffer.concat([id3,mp3()])), 'audio/mpeg');
});
test('track DTOs reject unsafe IDs, invalid fields, contributor JSON and percentages', () => {
  for(const id of ['0','-1','1.5','1e2','2147483648','1/../2',[],NaN]) assert.throws(() => trackId(id), {statusCode:400});
  assert.equal(trackId('23'),23);
  const contributor = {userId:1,role:'COMPOSER',percentage:60};
  for(const input of [{}, {title:[]}, {title:' '}, {title:'a'.repeat(192)}, {title:'a',prompt:1}, {title:'a',prompt:'한'.repeat(22000)}, {title:'a',isPublic:'yes'},
    {title:'a',contributors:'['}, {title:'a',contributors:'{}'}, {title:'a',contributors:[contributor,contributor]}, {title:'a',contributors:[{...contributor,percentage:0}]},
    {title:'a',contributors:[{...contributor,percentage:0.001}]}, {title:'a',contributors:[{...contributor,role:'INVALID'}]}, {title:'a',contributors:[contributor,{...contributor,userId:2}]},
    {title:'a',audioPath:'/etc/passwd'}]) assert.throws(() => parseCreateTrack(input),{statusCode:400});
  assert.equal(parseCreateTrack({title:' a ',isPublic:'false'}).isPublic,false);
  assert.equal(parseCreateTrack({title:'a',contributors:[{...contributor,percentage:33.33},{...contributor,userId:2,percentage:66.67}]}).contributors.length,2);
  for(const input of [{}, {ownerId:2}, {audioPath:'evil'}, {title:null}]) assert.throws(() => parseUpdateTrack(input), {statusCode:400});
  assert.deepEqual(parseUpdateTrack({prompt:null,isPublic:false}),{prompt:null,isPublic:false});
  for(const query of [{limit:'101'}, {page:'0'}, {page:['1','2']}, {sort:'audioPath'}, {order:'wrong'}, {scope:'all'}, {search:{x:1}}]) assert.throws(() => parseTrackList(query),{statusCode:400});
});
test('upload stores SHA-256, detected MIME and JSON-safe size without leaking local paths', async t => {
  const {dir,service,repo} = await fixture(t);
  const file = await upload(dir, wav(), 'application/octet-stream');
  const result = await service.create(1,{title:' Song ',isPublic:'false'},file);
  assert.equal(result.title,'Song'); assert.equal(result.audioHash,createHash('sha256').update(wav()).digest('hex'));
  assert.equal(result.fileSize,'52'); assert.equal(result.mimeType,'audio/wav'); assert.equal(result.isPublic,false);
  assert.equal(result.audioPath,`/api/tracks/${result.id}/audio`); assert.doesNotThrow(() => JSON.stringify(result));
  assert.equal(repo.records.get(result.id).audioPath,`/uploads/${file.filename}`);
  const mp3File = await upload(dir,mp3(),'audio/mpeg');
  assert.equal((await service.create(1,{title:'MP3'},mp3File)).mimeType,'audio/mpeg');
});
test('every validation and DB failure cleans an uploaded file', async t => {
  const {dir,service,repo,db} = await fixture(t);
  const cases = [ [{title:''},wav(),400], [{title:'a',contributors:'['},wav(),400], [{title:'a'},Buffer.from('fake'),415], [{title:'a'},Buffer.alloc(1001),413], [{title:'a'},Buffer.alloc(0),415] ];
  for(const [body,buffer,statusCode] of cases) {
    const file=await upload(dir,buffer);
    await assert.rejects(service.create(1,body,file),{statusCode});
    await assert.rejects(fs.stat(file.path),{code:'ENOENT'});
  }
  db.user.count=async()=>0;
  const unknownUser=await upload(dir);
  await assert.rejects(service.create(1,{title:'a',contributors:[{userId:999,role:'COMPOSER',percentage:50}]},unknownUser),{statusCode:400});
  await assert.rejects(fs.stat(unknownUser.path),{code:'ENOENT'});
  repo.failCreate=true;
  const file=await upload(dir);
  await assert.rejects(service.create(1,{title:'a'},file),/DB unavailable/);
  await assert.rejects(fs.stat(file.path),{code:'ENOENT'});
  await assert.rejects(service.create(1,{title:'a'}),{statusCode:400});
});
test('public/private reads hide work logs, filter own tracks, and reject anonymous mine', async t => {
  const {service,repo}=await fixture(t);
  repo.records.set(1,record(1)); repo.records.set(2,record(2,{isPublic:false,title:'Private'}));
  repo.records.set(3,record(3,{ownerId:2,title:'Winter'}));
  assert.equal((await service.list({})).total,2);
  assert.equal((await service.list({scope:'mine'},1)).total,2);
  await assert.rejects(service.list({scope:'mine'}),{statusCode:401});
  await assert.rejects(service.get(2),{statusCode:404}); await assert.rejects(service.get(2,2),{statusCode:404});
  assert.equal((await service.get(2,1)).workLog,'Private work log');
  assert.equal((await service.get(1,2)).prompt,null);
  assert.equal((await service.list({search:'summer',limit:'1',order:'asc'})).items[0].id,1);
  assert.equal((await service.list({page:'2',limit:'1',order:'asc'})).items[0].id,3);
  await assert.rejects(service.get(999),{statusCode:404});
});
test('only owners mutate/verify; registered and pending tracks remain immutable', async t => {
  const {service,repo}=await fixture(t); repo.records.set(1,record());
  await assert.rejects(service.update(1,2,{title:'Stolen'}),{statusCode:403});
  await assert.rejects(service.remove(1,2),{statusCode:403});
  await assert.rejects(service.verify(1,2),{statusCode:403});
  assert.equal((await service.update(1,1,{title:'New',prompt:null,isPublic:false})).title,'New');
  assert.equal((await service.verify(1,1)).status,'PENDING');
  for(const status of ['PENDING','REGISTERED']) {
    repo.records.get(1).registrationStatus=status;
    await assert.rejects(service.update(1,1,{title:'No'}),{statusCode:409});
    await assert.rejects(service.remove(1,1),{statusCode:409});
  }
  repo.records.get(1).registrationStatus='FAILED'; repo.records.get(1).registrationTxHash='0xproof';
  await assert.rejects(service.remove(1,1),{statusCode:409});
});
test('deletion removes local files, restores on DB failure and tolerates missing files', async t => {
  const {dir,service,repo}=await fixture(t); const file=await upload(dir);
  repo.records.set(1,record(1,{audioPath:`/uploads/${file.filename}`})); repo.failDelete=true;
  await assert.rejects(service.remove(1,1),/DB delete failed/);
  assert.deepEqual(await fs.readFile(file.path),wav()); assert.equal(repo.records.size,1);
  assert.equal((await fs.readdir(dir)).some(name=>name.startsWith('.delete-')),false);
  repo.failDelete=false; await service.remove(1,1);
  await assert.rejects(fs.stat(file.path),{code:'ENOENT'}); assert.equal(repo.records.size,0);
  repo.records.set(2,record(2)); await service.remove(2,1); assert.equal(repo.records.size,0);
});
test('local file access prevents traversal and symlink reads/deletes', async t => {
  const {dir,files,repo,service}=await fixture(t);
  for(const value of ['/etc/passwd','/uploads/../secret','/uploads/..','/uploads/a/b','/uploads/a\\b','/uploads/.delete-test','/uploads/']) assert.throws(()=>files.resolve(value),{statusCode:400});
  const target=path.join(root,'private-data'); await fs.writeFile(target,'secret');
  await fs.symlink(target,path.join(dir,'linked.wav'));
  repo.records.set(1,record(1,{audioPath:'/uploads/linked.wav'}));
  await assert.rejects(service.audio(1),{statusCode:400}); await assert.rejects(service.remove(1,1),{statusCode:400});
  assert.equal(await fs.readFile(target,'utf8'),'secret'); assert.equal(repo.records.size,1);
});

async function serve(t, app) {
  const server = await new Promise((resolve,reject) => {
    const running=app.listen(0,'127.0.0.1',error=>error ? reject(error) : resolve(running)); running.on('error',reject);
  });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}
test('HTTP upload, CRUD, authentication, pagination and byte-range playback', async t => {
  const express=require('express'); const jwt=require('jsonwebtoken');
  const {TrackController}=require('../dist/controllers/track.controller');
  const {createTrackRoutes}=require('../dist/routes/track.routes');
  const {service,repo}=await fixture(t,root);
  const app=express(); app.use(express.json()); app.use('/api/tracks',createTrackRoutes(new TrackController(service)));
  app.use((error,_req,res,_next)=>res.status(error.statusCode ?? (error.type==='entity.parse.failed'?400:500)).json({error:error.message}));
  const base=await serve(t,app);
  const token = id => jwt.sign({tokenType:'access'},process.env.JWT_ACCESS_SECRET,{subject:String(id),expiresIn:'15m'});
  const auth = id => ({Authorization:`Bearer ${token(id)}`});
  function form(options={}) {
    const body=new FormData(); body.set('title',options.title ?? 'Public track');
    body.set('isPublic',options.isPublic ?? 'true');
    if(options.contributors!==undefined) body.set('contributors',options.contributors);
    body.set('audio',new Blob([options.bytes ?? wav()],{type:options.mime ?? 'audio/wav'}),'../../dangerous.wav');
    if(options.second) body.append('audio',new Blob([wav()],{type:'audio/wav'}),'extra.wav');
    return body;
  }
  assert.equal((await fetch(`${base}/api/tracks`,{method:'POST',body:form()})).status,401);
  const created=await fetch(`${base}/api/tracks`,{method:'POST',headers:auth(1),body:form()});
  assert.equal(created.status,201); const track=await created.json();
  assert.equal(track.fileSize,'52'); assert.equal(track.audioPath,`/api/tracks/${track.id}/audio`);
  const completeForm=form({title:'All metadata'}); completeForm.set('prompt','prompt'); completeForm.set('workLog','work log'); completeForm.set('contributors','[]');
  const complete=await fetch(`${base}/api/tracks`,{method:'POST',headers:auth(1),body:completeForm});
  assert.equal(complete.status,201);
  const completeTrack=await complete.json();
  assert.equal((await fetch(`${base}/api/tracks/${completeTrack.id}`,{method:'DELETE',headers:auth(1)})).status,204);
  const filename=path.basename(repo.records.get(track.id).audioPath);
  assert.match(filename,/^[0-9a-f-]{36}\.audio$/); assert.ok(!filename.includes('dangerous'));
  const list=await fetch(`${base}/api/tracks?search=Public&limit=1`);
  assert.equal(list.status,200); assert.equal(list.headers.get('x-total-count'),'1');
  assert.equal((await list.json()).length,1);
  assert.equal((await fetch(`${base}/api/tracks?scope=mine`)).status,401);
  assert.equal((await fetch(`${base}/api/tracks?limit=0`)).status,400);
  assert.equal((await fetch(`${base}/api/tracks?sort=ownerId`)).status,400);
  assert.equal((await fetch(`${base}/api/tracks`,{headers:{Authorization:'Bearer invalid'}})).status,401);
  assert.equal((await fetch(`${base}/api/tracks/1e2`)).status,400);
  const ranged=await fetch(`${base}${track.audioPath}`,{headers:{Range:'bytes=0-3'}});
  assert.equal(ranged.status,206); assert.equal(ranged.headers.get('content-range'),'bytes 0-3/52');
  assert.equal(ranged.headers.get('content-length'),'4'); assert.equal(await ranged.text(),'RIFF');
  const suffix=await fetch(`${base}${track.audioPath}`,{headers:{Range:'bytes=-4'}});
  assert.equal(suffix.status,206); assert.deepEqual(Buffer.from(await suffix.arrayBuffer()),wav().subarray(48));
  const openEnd=await fetch(`${base}${track.audioPath}`,{headers:{Range:'bytes=48-'}});
  assert.equal(openEnd.status,206); assert.equal((await openEnd.arrayBuffer()).byteLength,4);
  for(const range of ['bytes=52-','bytes=4-3','bytes=0-2,4-6','bytes=-0','junk']) {
    const response=await fetch(`${base}${track.audioPath}`,{headers:{Range:range}});
    assert.equal(response.status,416); assert.equal(response.headers.get('content-range'),'bytes */52');
  }
  const head=await fetch(`${base}${track.audioPath}`,{method:'HEAD'});
  assert.equal(head.status,200); assert.equal(head.headers.get('content-length'),'52'); assert.equal(await head.text(),'');
  const download=await fetch(`${base}${track.audioPath}?download=true`);
  assert.match(download.headers.get('content-disposition'),/^attachment;/); assert.equal(download.headers.get('content-type'),'audio/wav');
  assert.deepEqual(Buffer.from(await download.arrayBuffer()),wav());
  assert.equal((await fetch(`${base}${track.audioPath}?download=invalid`)).status,400);
  const unauthorizedPatch=await fetch(`${base}/api/tracks/${track.id}`,{method:'PATCH',headers:{...auth(2),'Content-Type':'application/json'},body:JSON.stringify({title:'Stolen'})});
  assert.equal(unauthorizedPatch.status,403);
  const patch=await fetch(`${base}/api/tracks/${track.id}`,{method:'PATCH',headers:{...auth(1),'Content-Type':'application/json'},body:JSON.stringify({title:'Private track',isPublic:false,prompt:'secret'})});
  assert.equal(patch.status,200); assert.equal((await patch.json()).isPublic,false);
  assert.equal((await fetch(`${base}/api/tracks/${track.id}`)).status,404);
  assert.equal((await fetch(`${base}${track.audioPath}`,{headers:auth(2)})).status,404);
  const ownDetail=await fetch(`${base}/api/tracks/${track.id}`,{headers:auth(1)});
  assert.equal(ownDetail.status,200); assert.equal((await ownDetail.json()).prompt,'secret');
  const ownAudio=await fetch(`${base}${track.audioPath}`,{headers:auth(1)});
  assert.equal(ownAudio.status,200); await ownAudio.arrayBuffer();
  const before=(await fs.readdir(root)).sort();
  for(const [options,status] of [[{contributors:'['},400],[{title:''},400],[{bytes:Buffer.from('fake')},415],[{mime:'text/plain'},415],[{bytes:Buffer.alloc(2000)},413],[{second:true},400]]) {
    const response=await fetch(`${base}/api/tracks`,{method:'POST',headers:auth(1),body:form(options)});
    assert.equal(response.status,status);
    assert.deepEqual((await fs.readdir(root)).sort(),before);
  }
  const {audioUpload}=require('../dist/middlewares/upload.middleware');
  const originalHandler=audioUpload.storage._handleFile;
  try {
    audioUpload.storage._handleFile=(_req,_file,callback)=>callback(Object.assign(new Error('Storage unavailable'),{code:'ENOSPC'}));
    const storageFailure=await fetch(`${base}/api/tracks`,{method:'POST',headers:auth(1),body:form()});
    assert.equal(storageFailure.status,500);
    assert.deepEqual((await fs.readdir(root)).sort(),before);
  } finally { audioUpload.storage._handleFile=originalHandler; }
  repo.records.get(track.id).registrationStatus='REGISTERED';
  assert.equal((await fetch(`${base}/api/tracks/${track.id}`,{method:'DELETE',headers:auth(1)})).status,409);
  repo.records.get(track.id).registrationStatus='NOT_REGISTERED';
  assert.equal((await fetch(`${base}/api/tracks/${track.id}`,{method:'DELETE',headers:auth(2)})).status,403);
  assert.equal((await fetch(`${base}/api/tracks/${track.id}`,{method:'DELETE',headers:auth(1)})).status,204);
  await assert.rejects(fs.stat(path.join(root,filename)),{code:'ENOENT'});
});
test('real app removes static upload access and returns 400 for malformed JSON', async t => {
  const app=require('../dist/app').default;
  const base=await serve(t,app); const file=await upload(root);
  assert.equal((await fetch(`${base}/uploads/${file.filename}`)).status,404);
  assert.equal((await fetch(`${base}/health`)).status,200);
  const badJson=await fetch(`${base}/api/tracks/1`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:'{'});
  assert.equal(badJson.status,400); assert.deepEqual(await badJson.json(),{error:'Invalid JSON body'});
  const {prisma}=require('../dist/utils/prisma'); t.after(()=>prisma.$disconnect());
});
test('Swagger documents track APIs, authorization, visibility and pagination', () => {
  const {swaggerSpec}=require('../dist/docs/swagger');
  for(const [route,method] of [['/api/tracks','post'],['/api/tracks','get'],['/api/tracks/{id}','get'],['/api/tracks/{id}','patch'],['/api/tracks/{id}','delete'],['/api/tracks/{id}/audio','get']]) assert.ok(swaggerSpec.paths[route][method]);
  assert.equal(swaggerSpec.components.schemas.Track.properties.fileSize.type,'string');
  assert.ok(swaggerSpec.paths['/api/tracks'].get.responses['200'].headers['X-Total-Count']);
  assert.ok(swaggerSpec.paths['/api/tracks/{id}/audio'].get.responses['416']);
  assert.ok(swaggerSpec.paths['/api/v1/auth/login'].post);
});
