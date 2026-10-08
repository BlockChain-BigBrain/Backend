import path from "node:path";
import fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { config } from "../config";
import { AppError } from "./errors";
import { detectAudio } from "./audioFile";
import { logServerError } from "./errorLogger";

export class TrackFiles {
  readonly root: string;
  constructor(root = config.uploadDir, readonly maxBytes = config.maxUploadBytes) {
    this.root = path.resolve(root);
  }
  resolve(audioPath: string): string {
    if (!audioPath.startsWith("/uploads/")) throw new AppError(400, "Unsafe audio path");
    const filename = audioPath.slice("/uploads/".length);
    if (!filename || filename === "." || filename === ".." || /[/\\\x00]/.test(filename) || filename.startsWith(".delete-")) throw new AppError(400, "Unsafe audio path");
    return path.join(this.root, filename);
  }
  async open(audioPath: string) {
    const filename = this.resolve(audioPath);
    try {
      const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) throw new AppError(415, "Audio is not a regular file");
        return { handle, size: stat.size, filename };
      } catch (error) { await handle.close(); throw error; }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") throw new AppError(404, "Audio file not found");
      if (code === "ELOOP") throw new AppError(400, "Symbolic links are not allowed");
      throw error;
    }
  }
  async inspect(file: Express.Multer.File) {
    const audioPath = `/uploads/${file.filename}`;
    if (path.resolve(file.path) !== this.resolve(audioPath)) throw new AppError(400, "Unsafe upload path");
    const opened = await this.open(audioPath);
    try {
      if (opened.size <= 0) throw new AppError(415, "Audio file is empty");
      if (opened.size > this.maxBytes) throw new AppError(413, "Audio file is too large");
      const buffer = await opened.handle.readFile();
      const mimeType = detectAudio(buffer);
      return { audioPath, mimeType, audioHash: createHash("sha256").update(buffer).digest("hex"), fileSize: BigInt(buffer.length) };
    } finally { await opened.handle.close(); }
  }
  async cleanup(file?: Express.Multer.File) {
    if (!file || (!file.path && !file.filename)) return;
    const filename = this.resolve(`/uploads/${file.filename}`);
    if (path.resolve(file.path) !== filename) throw new AppError(400, "Unsafe upload path");
    await this.unlink(filename);
  }
  private async unlink(filename: string) {
    try { await fs.unlink(filename); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  async stageDelete(audioPath: string) {
    // Verify regular file / reject links before moving. Missing legacy files do not block DB deletion.
    const filename = this.resolve(audioPath);
    let opened;
    try { opened = await this.open(audioPath); }
    catch (error) { if (error instanceof AppError && error.statusCode === 404) return undefined; throw error; }
    await opened.handle.close();
    const staged = path.join(this.root, `.delete-${randomUUID()}`);
    await fs.rename(filename, staged);
    return { restore: () => fs.rename(staged, filename), finish: () => this.unlink(staged) };
  }
  async cleanupAfterFailure(file?: Express.Multer.File) {
    try { await this.cleanup(file); } catch (error) { logServerError("upload_cleanup_failed", error); }
  }
}
