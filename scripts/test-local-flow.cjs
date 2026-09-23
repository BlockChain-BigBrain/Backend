require('dotenv/config');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname) && process.env.NODE_ENV !== 'production', 'Only a local development database is allowed');
  const uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'track-flow-'));
  process.env.UPLOAD_DIR = uploadDir;
  process.env.COOKIE_SECURE = 'false';
  process.env.FRONTEND_URL = 'http://localhost:4000';
  const app = require('../dist/app').default;
  const {prisma} = require('../dist/utils/prisma');
  const email = `flow-${randomUUID()}@example.test`;
  const password = randomUUID();
  let server;
  try {
    await prisma.$queryRaw`SELECT 1`;
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve,reject) => {server.once('listening',resolve);server.once('error',reject);});
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = {'Content-Type':'application/json', Origin:'http://localhost:4000'};
    const jsonPost = (route, body, extra={}) => fetch(base+route,{method:'POST', headers:{...headers,...extra},body:JSON.stringify(body)});
    let preflight = await fetch(base+'/api/v1/auth/refresh?target=frontend',{method:'OPTIONS',headers:{Origin:'http://localhost:4000','Access-Control-Request-Method':'POST'}});
    assert.equal(preflight.status,204);
    assert.equal(preflight.headers.get('access-control-allow-origin'),'http://localhost:4000');
    assert.equal(preflight.headers.get('access-control-allow-credentials'),'true');
    let missing = await jsonPost('/api/v1/auth/refresh?target=frontend',{});assert.equal(missing.status,401);
    let forbidden = await jsonPost('/api/v1/auth/refresh?target=frontend',{}, {Origin:'https://untrusted.example'});assert.equal(forbidden.status,403);
    console.log('PASS CORS preflight, missing-cookie 401 and untrusted-origin rejection');
    let response = await jsonPost('/api/v1/auth/signup',{email,password,nickname:'Integration test'});
    assert.equal(response.status,201); console.log('PASS signup using real local MySQL');
    response = await jsonPost('/api/v1/auth/login?target=frontend',{email,password:'incorrect-password'});
    assert.equal(response.status,401);
    response = await jsonPost('/api/v1/auth/login?target=frontend',{email,password});
    assert.equal(response.status,200);
    assert.match(response.headers.get('set-cookie'), /HttpOnly/i);
    assert.match(response.headers.get('set-cookie'), /SameSite=Strict/i);
    let cookie = response.headers.get('set-cookie').split(';')[0];
    assert.ok(cookie.startsWith('frontendRefreshToken='));
    let accessToken = (await response.json()).result.accessToken;
    console.log('PASS password login and refresh cookie issuance');
    response = await fetch(base+'/api/v1/auth/me',{headers:{Authorization:`Bearer ${accessToken}`}});
    assert.equal(response.status,200); assert.equal((await response.json()).result.email,email);
    response = await fetch(base+'/api/tracks',{method:'POST'});assert.equal(response.status,401);
    const wav = Buffer.alloc(46);wav.write('RIFF');wav.writeUInt32LE(38,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(2,40);
    const form = new FormData();form.append('audio',new Blob([wav],{type:'audio/wav'}),'test.wav');form.append('title','Local flow test');
    response = await fetch(base+'/api/tracks',{method:'POST',headers:{Authorization:`Bearer ${accessToken}`},body:form});
    assert.equal(response.status,201);const track = await response.json();
    assert.equal(track.title,'Local flow test');assert.equal('passwordHash' in track.owner,false);assert.equal('refreshTokenHash' in track.owner,false);
    response = await fetch(base+track.audioPath);assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),wav);
    console.log('PASS authenticated multipart WAV upload, file storage and playback URL');
    response = await fetch(base+'/api/tracks');assert.equal(response.status,200);
    const tracks = await response.json();assert.ok(tracks.some(t=>t.id===track.id));
    for(const t of tracks) {assert.equal('passwordHash' in t.owner,false);assert.equal('refreshTokenHash' in t.owner,false);}
    response = await fetch(base+`/api/tracks/${track.id}`);assert.equal(response.status,200);
    console.log('PASS public track list/detail without private user fields');
    response = await jsonPost('/api/v1/auth/refresh?target=frontend',{}, {Cookie:cookie});assert.equal(response.status,200);
    cookie = response.headers.get('set-cookie').split(';')[0];accessToken=(await response.json()).result.accessToken;
    response = await jsonPost('/api/v1/auth/logout?target=frontend',{}, {Cookie:cookie});assert.equal(response.status,200);
    response = await jsonPost('/api/v1/auth/refresh?target=frontend',{}, {Cookie:cookie});assert.equal(response.status,401);
    console.log('PASS session refresh, logout and revoked-session rejection');
  } finally {
    if(server) await new Promise(resolve=>server.close(resolve));
    const user=await prisma.user.findUnique({where:{email},select:{id:true}});
    if(user) {await prisma.track.deleteMany({where:{ownerId:user.id}});await prisma.user.delete({where:{id:user.id}});}
    await prisma.$disconnect();
    await fs.rm(uploadDir,{recursive:true,force:true});
    console.log('Temporary test account, tracks and audio files removed');
  }
}
main().catch(error=>{console.error(error instanceof assert.AssertionError ? error.message : require('../dist/utils/errorLogger').errorSummary(error));process.exitCode=1;});
