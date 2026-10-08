import { AppError } from "./errors";

// Validate actual structure, not the multipart MIME or original filename.
export function detectAudio(buffer: Buffer): "audio/wav" | "audio/mpeg" {
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WAVE") {
    const end = buffer.readUInt32LE(4) + 8;
    if (end !== buffer.length) throw new AppError(415, "Invalid WAV length");
    let offset = 12, format = false, data = false, blockAlign = 0;
    while (offset + 8 <= end) {
      const name = buffer.toString("ascii", offset, offset + 4), size = buffer.readUInt32LE(offset + 4);
      const start = offset + 8;
      if (start + size > end) throw new AppError(415, "Truncated WAV chunk");
      if (name === "fmt ") {
        if (format || size < 16) throw new AppError(415, "Invalid WAV format");
        const codec = buffer.readUInt16LE(start), channels = buffer.readUInt16LE(start + 2), rate = buffer.readUInt32LE(start + 4);
        const bits = buffer.readUInt16LE(start + 14);
        blockAlign = buffer.readUInt16LE(start + 12);
        if (![1, 3].includes(codec) || channels < 1 || channels > 32 || rate < 8000 || rate > 384000 || ![8, 16, 24, 32, 64].includes(bits) || (codec === 3 && ![32, 64].includes(bits)) || blockAlign !== channels * bits / 8 || buffer.readUInt32LE(start + 8) !== rate * blockAlign) throw new AppError(415, "Unsupported or invalid WAV format (PCM/IEEE float required)");
        format = true;
      }
      if (name === "data") {
        if (!format || data || size === 0 || size % blockAlign !== 0) throw new AppError(415, "Invalid WAV audio data");
        data = true;
      }
      offset = start + size + (size % 2);
    }
    if (offset !== end || !format || !data) throw new AppError(415, "Invalid WAV chunks");
    return "audio/wav";
  }
  let offset = 0;
  if (buffer.toString("ascii", 0, 3) === "ID3") {
    if (buffer.length < 10 || ![2, 3, 4].includes(buffer[3]) || buffer[4] === 255 || buffer.subarray(6, 10).some(byte => byte >= 128)) throw new AppError(415, "Invalid ID3 header");
    const size = (buffer[6] << 21) | (buffer[7] << 14) | (buffer[8] << 7) | buffer[9];
    offset = 10 + size + (buffer[3] === 4 && (buffer[5] & 16) ? 10 : 0);
  }
  let frames = 0;
  let streamVersion: number | undefined, streamRate: number | undefined;
  while (offset < buffer.length) {
    if (frames >= 2 && buffer.length - offset === 128 && buffer.toString("ascii", offset, offset + 3) === "TAG") { offset += 128; break; }
    if (offset + 4 > buffer.length || buffer[offset] !== 255 || (buffer[offset + 1] & 224) !== 224) throw new AppError(415, "Invalid MP3 frame");
    const version = (buffer[offset + 1] >> 3) & 3, layer = (buffer[offset + 1] >> 1) & 3;
    const bitrateIndex = buffer[offset + 2] >> 4, rateIndex = (buffer[offset + 2] >> 2) & 3;
    if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) throw new AppError(415, "Unsupported MP3 header");
    const bitrates = version === 3 ? [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320] : [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160];
    const rate = [44100,48000,32000][rateIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    if (streamVersion !== undefined && (streamVersion !== version || streamRate !== rate)) throw new AppError(415, "Inconsistent MP3 stream");
    streamVersion = version; streamRate = rate;
    const frameSize = Math.floor((version === 3 ? 144 : 72) * bitrates[bitrateIndex] * 1000 / rate) + ((buffer[offset + 2] >> 1) & 1);
    if (offset + frameSize > buffer.length) throw new AppError(415, "Truncated MP3 frame");
    offset += frameSize; frames++;
  }
  if (frames < 2 || offset !== buffer.length) throw new AppError(415, "At least two complete MP3 frames are required");
  return "audio/mpeg";
}
