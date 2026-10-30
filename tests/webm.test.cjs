const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {inspectWebm}=require('../dist/utils/webmAudio');
const {TrackFiles}=require('../dist/utils/trackFiles');
function sample(video=false){
 const args=['-v','error','-f','lavfi','-i',video?'color=size=16x16:rate=1':'sine=frequency=440:sample_rate=48000'];
 if(video)args.push('-c:v','libvpx');else args.push('-c:a','libopus');
 const r=spawnSync('ffmpeg',[...args,'-t','0.2','-f','webm','pipe:1']);
 assert.equal(r.status,0,r.stderr?.toString());return r.stdout;
}
test('WebM validates actual audio, rejects video-only/spoofed content and preserves original hash',async()=>{
 const bytes=sample();assert.equal(await inspectWebm(bytes),'audio/webm');
 await assert.rejects(inspectWebm(sample(true)),{statusCode:415});
 await assert.rejects(inspectWebm(Buffer.from('fake webm')),{statusCode:415});
 await assert.rejects(inspectWebm(bytes.subarray(0,8)),{statusCode:415});
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'webm-test-'));
 try{const filename='sample.audio',p=path.join(dir,filename);await fs.writeFile(p,bytes);
 const actual=await new TrackFiles(dir).inspect({filename,path:p});
 assert.equal(actual.mimeType,'audio/webm');assert.equal(actual.audioHash,createHash('sha256').update(bytes).digest('hex'));
 assert.deepEqual(await fs.readFile(p),bytes);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
