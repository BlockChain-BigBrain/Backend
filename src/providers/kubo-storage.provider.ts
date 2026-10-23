import { canonicalJson } from "../utils/canonicalJson";
import { createHash } from "node:crypto";
import { config } from "../config";
import { validCid } from "../services/metadata.service";
import { TrackFiles } from "../utils/trackFiles";
import { AppError } from "../utils/errors";
import { StorageProvider, StorageUploadRequest, StorageUploadResult } from "./storage.provider";

const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
export class KuboStorageProvider implements StorageProvider {
  readonly configured = true;
  private readonly base: string;
  constructor(base = config.ipfsApiUrl, private readonly files = new TrackFiles()) {
    const url = new URL(base);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Invalid IPFS_API_URL");
    this.base = base.replace(/\/$/, "");
  }
  private async call(route: string, body?: FormData) {
    const response = await fetch(`${this.base}/api/v0/${route}`, { method: "POST", body, redirect: "error", signal: AbortSignal.timeout(config.ipfsTimeoutMs) });
    if (!response.ok) throw new AppError(502, "IPFS request failed");
    return response;
  }
  private async add(bytes: Uint8Array, name: string) {
    const form = new FormData(); form.set("file", new Blob([new Uint8Array(bytes)]), name);
    const response = await this.call("add?cid-version=1&pin=true&wrap-with-directory=false", form);
    const text = await response.text();
    if (text.length > 4096) throw new AppError(502, "Invalid IPFS add response");
    let data: any;
    try { data = JSON.parse(text.trim()); } catch { throw new AppError(502, "Invalid IPFS add response"); }
    if (!validCid(data.Hash)) throw new AppError(502, "IPFS returned an invalid CID");
    return data.Hash as string;
  }
  async upload(input: StorageUploadRequest): Promise<StorageUploadResult> {
    const metadata = Buffer.from(canonicalJson(input.metadata));
    if (sha(metadata) !== input.metadataHash) throw new AppError(409, "Metadata content changed");
    const opened = await this.files.open(input.audioPath);
    let audio: Buffer;
    try {
      if (opened.size > config.maxUploadBytes) throw new AppError(413, "Audio file is too large");
      audio = await opened.handle.readFile();
    } finally { await opened.handle.close(); }
    if (sha(audio) !== input.audioHash) throw new AppError(409, "Audio content changed");
    const audioCid = await this.add(audio, "audio");
    const metadataCid = await this.add(metadata, "metadata.json");
    return { source: "REAL", metadataHash: input.metadataHash, metadataCid, audioCid };
  }
  private async matches(cid: string, expectedHash: string, maxBytes: number) {
    if (!validCid(cid)) return false;
    const response = await this.call(`cat?arg=${encodeURIComponent(cid)}`);
    if (!response.body) return false;
    const reader = response.body.getReader(), digest = createHash("sha256"); let size = 0;
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > maxBytes) return false; digest.update(value); }
      return digest.digest("hex") === expectedHash;
    } finally { await reader.cancel(); }
  }
  async verify(input: StorageUploadRequest, result: StorageUploadResult) {
    if (result.source !== "REAL" || result.metadataHash !== input.metadataHash || !result.audioCid) return false;
    return await this.matches(result.metadataCid, input.metadataHash, 1024 * 1024) && await this.matches(result.audioCid, input.audioHash, config.maxUploadBytes);
  }
}
