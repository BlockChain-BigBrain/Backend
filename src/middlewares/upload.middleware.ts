import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import multer from "multer";
import { RequestHandler } from "express";
import { config } from "../config";
import { AppError } from "../utils/errors";
import { TrackFiles } from "../utils/trackFiles";

const uploadDir = path.resolve(config.uploadDir);
fs.mkdirSync(uploadDir, { recursive: true });

export const audioUpload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, _file, callback) => callback(null, `${randomUUID()}.audio`),
  }),
  limits: { fileSize: config.maxUploadBytes, files: 1, fields: 5, fieldSize: 65535, parts: 6 },
  fileFilter: (_req, file, callback) => {
    if (!["audio/webm", "video/webm", "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave", "application/octet-stream"].includes(file.mimetype)) return callback(new AppError(415, "Only MP3, WAV and WebM uploads are supported"));
    callback(null, true);
  },
});

// Multer handles partial uploads; this also cleans completed files on multipart errors.
export const uploadAudio: RequestHandler = (req, res, next) => {
  audioUpload.single("audio")(req, res, error => {
    if (!error) return next();
    void new TrackFiles().cleanupAfterFailure(req.file).then(() => {
      if (error instanceof multer.MulterError) {
        return next(new AppError(error.code === "LIMIT_FILE_SIZE" ? 413 : 400, error.code === "LIMIT_FILE_SIZE" ? "Audio file is too large" : "Invalid multipart upload"));
      }
      // Filesystem/storage errors are server failures, not invalid client input.
      next(error instanceof AppError || typeof error.code === "string" ? error : new AppError(400, "Malformed multipart upload"));
    });
  });
};
