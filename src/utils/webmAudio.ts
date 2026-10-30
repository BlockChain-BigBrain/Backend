import { spawn } from "node:child_process";
import { AppError } from "./errors";

export const isEbml = (bytes: Buffer) => bytes.length >= 4 && bytes.readUInt32BE(0) === 0x1a45dfa3;
// Read the EBML header only; do not mistake a Matroska container for WebM.
function webmHeader(bytes: Buffer): boolean {
  function vint(offset: number, id = false): [number, number] {
    let length = 1;
    while (length <= 8 && !(bytes[offset] & (0x80 >> (length - 1)))) length++;
    if (length > 8 || offset + length > bytes.length) throw new Error();
    let value = id ? bytes[offset] : bytes[offset] & (0xff >> length);
    for (let i = 1; i < length; i++) value = value * 256 + bytes[offset + i];
    if (!Number.isSafeInteger(value)) throw new Error();
    return [value, length];
  }
  try {
    const [size, width] = vint(4); let offset = 4 + width; const end = offset + size;
    if (end > bytes.length || size > 4096) return false;
    let docType = "";
    while (offset < end) {
      const [id, iw] = vint(offset, true); offset += iw;
      const [length, sw] = vint(offset); offset += sw;
      if (offset + length > end) return false;
      if (id === 0x4282) docType = bytes.toString("ascii", offset, offset + length);
      offset += length;
    }
    return docType === "webm";
  } catch { return false; }
}
export async function inspectWebm(bytes: Buffer): Promise<"audio/webm" | "video/webm"> {
  if (!webmHeader(bytes)) throw new AppError(415, "Invalid WebM header");
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", ["-v", "error", "-protocol_whitelist", "pipe", "-show_entries", "stream=codec_type,codec_name:format=format_name", "-of", "json", "pipe:0"], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "", errors = "", settled = false;
    const finish = (error?: AppError, mime?: "audio/webm" | "video/webm") => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (error) { child.kill("SIGKILL"); reject(error); } else resolve(mime!);
    };
    const timer = setTimeout(() => finish(new AppError(415, "WebM inspection timed out")), 15000);
    child.on("error", () => finish(new AppError(503, "WebM uploads require ffprobe on the backend server")));
    child.stdout.on("data", chunk => { output += chunk; if (output.length > 65536) finish(new AppError(415, "WebM stream metadata too large")); });
    child.stderr.on("data", chunk => { errors += chunk; if (errors.length > 65536) finish(new AppError(415, "Invalid WebM container")); });
    child.stdin.on("error", () => {});
    child.on("close", code => {
      if (settled) return;
      try {
        const data = JSON.parse(output), streams = data.streams;
        if (code !== 0 || errors.trim() || !Array.isArray(streams) || !streams.some(s => s.codec_type === "audio" && ["opus", "vorbis"].includes(s.codec_name))) throw new Error();
        finish(undefined, streams.some(s => s.codec_type === "video") ? "video/webm" : "audio/webm");
      } catch { finish(new AppError(415, "WebM must contain a valid Opus or Vorbis audio track")); }
    });
    child.stdin.end(bytes);
  });
}
