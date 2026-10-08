const { randomUUID } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs/promises');
function wav() {
  const buffer = Buffer.alloc(52);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(44, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(8000, 24); buffer.writeUInt32LE(16000, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(8, 40);
  buffer.writeInt16LE(1234, 44); buffer.writeInt16LE(-1234, 46);
  return buffer;
}
function mp3() {
  const frame = Buffer.alloc(417); frame.set([0xff, 0xfb, 0x90, 0x00]);
  return Buffer.concat([frame, frame]);
}
async function upload(root, buffer = wav(), mimetype = 'audio/wav') {
  const filename = `${randomUUID()}.audio`, filePath = path.join(root, filename);
  await fs.writeFile(filePath, buffer);
  return { filename, path: filePath, size: buffer.length, mimetype, originalname: '../../untrusted.wav', fieldname: 'audio', destination: root };
}
function record(id = 1, extra = {}) {
  return { id, title: 'Summer', prompt: 'Private prompt', workLog: 'Private work log', audioPath: '/uploads/legacy.wav', mimeType: 'audio/wav', ownerId: 1,
    isPublic: true, audioHash: null, fileSize: 52n, duration: null, registrationStatus: 'NOT_REGISTERED', registrationTxHash: null, blockchainTrackId: null,
    metadataCid: null, audioCid: null, contributionsFinalizedAt: null, createdAt: new Date('2026-10-08T00:00:00Z'), updatedAt: new Date('2026-10-08T00:00:00Z'),
    owner: { id: 1, name: 'Creator', profileImage: null }, contributions: [], verifications: [], ...extra };
}
function repository() {
  const records = new Map();
  const repo = {
    records, failCreate: false, failDelete: false,
    async create(data) {
      if (this.failCreate) throw new Error('DB unavailable');
      const { owner, contributions, ...fields } = data;
      const item = record(records.size + 1, { ...fields, ownerId: owner.connect.id, contributions: contributions.create ?? [] });
      records.set(item.id, item); return item;
    },
    async findMany(query, userId) {
      let items = [...records.values()].filter(track => query.scope === 'mine' ? track.ownerId === userId : track.isPublic);
      if (query.search) items = items.filter(track => track.title.toLowerCase().includes(query.search.toLowerCase()));
      items.sort((a,b) => { const primary = a[query.sort] < b[query.sort] ? -1 : a[query.sort] > b[query.sort] ? 1 : a.id - b.id; return primary * (query.order === 'asc' ? 1 : -1); });
      return { total: items.length, items: items.slice((query.page-1)*query.limit, query.page*query.limit) };
    },
    async findById(id) { return records.get(id) ?? null; },
    async withLockedTrack(id, operation) {
      const track = records.get(id);
      if (!track) { const {AppError} = require('../../dist/utils/errors'); throw new AppError(404, 'Track not found'); }
      return operation({ verification: { create: async ({data}) => data } }, track);
    },
    async update(_tx,id,data) { const track = {...records.get(id), ...data}; records.set(id, track); return track; },
    async delete(_tx,id) { if(this.failDelete) throw new Error('DB delete failed'); records.delete(id); },
  };
  return repo;
}
module.exports = { wav, mp3, upload, record, repository };
