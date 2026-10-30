import { Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import { trackId } from "../dto/track.dto";
import { TrackService } from "../services/track.service";
import { AppError } from "../utils/errors";

export class TrackController {
  constructor(private readonly tracks: TrackService) {}
  create = async (req: AuthenticatedRequest, res: Response) => {
    res.status(201).json(await this.tracks.create(req.userId!, req.body, req.file));
  };
  list = async (req: AuthenticatedRequest, res: Response) => {
    const result = await this.tracks.list(req.query, req.userId);
    res.set({ "X-Total-Count": String(result.total), "X-Page": String(result.page), "X-Limit": String(result.limit) });
    res.json(result.items);
  };
  get = async (req: AuthenticatedRequest, res: Response) => {
    res.set("Cache-Control", "private, no-store");
    res.json(await this.tracks.get(trackId(req.params.id), req.userId));
  };
  update = async (req: AuthenticatedRequest, res: Response) => {
    res.json(await this.tracks.update(trackId(req.params.id), req.userId!, req.body));
  };
  remove = async (req: AuthenticatedRequest, res: Response) => {
    await this.tracks.remove(trackId(req.params.id), req.userId!);
    res.status(204).send();
  };
  verify = async (req: AuthenticatedRequest, res: Response) => {
    res.status(201).json(await this.tracks.verify(trackId(req.params.id), req.userId!));
  };
  audio = async (req: AuthenticatedRequest, res: Response) => {
    if (req.query.download !== undefined && req.query.download !== "true" && req.query.download !== "false") throw new AppError(400, "download must be true or false");
    const audio = await this.tracks.audio(trackId(req.params.id), req.userId);
    if (req.aborted || res.destroyed) { await audio.handle.close(); return; }
    let start = 0, end = audio.size - 1;
    res.set({ "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Type": audio.mimeType });
    const range = req.headers["if-range"] ? undefined : req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match && (match[1] || match[2])) {
        if (!match[1]) {
          const suffix = Number(match[2]);
          start = Number.isSafeInteger(suffix) && suffix > 0 ? Math.max(0, audio.size - suffix) : audio.size;
        } else {
          start = Number(match[1]);
          if (match[2]) end = Math.min(Number(match[2]), end);
        }
      } else start = audio.size;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= audio.size) {
        await audio.handle.close();
        res.status(416).set("Content-Range", `bytes */${audio.size}`).end(); return;
      }
      res.status(206).set("Content-Range", `bytes ${start}-${end}/${audio.size}`);
    }
    const extension = audio.mimeType === "audio/mpeg" ? "mp3" : audio.mimeType.endsWith("/webm") ? "webm" : "wav";
    res.set({ "Content-Length": String(Math.max(0, end - start + 1)), "Content-Disposition": `${req.query.download === "true" ? "attachment" : "inline"}; filename="track-${audio.id}.${extension}"` });
    if (req.method === "HEAD" || audio.size === 0) { await audio.handle.close(); res.end(); return; }
    const stream = audio.handle.createReadStream({ start, end, autoClose: true });
    stream.on("error", () => res.destroy());
    res.on("close", () => stream.destroy());
    stream.pipe(res);
  };
}
