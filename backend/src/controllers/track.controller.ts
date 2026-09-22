import { Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import { TrackService } from "../services/track.service";

export class TrackController {
  constructor(private readonly tracks: TrackService) {}
  create = async (req: AuthenticatedRequest, res: Response) => {
    const contributors = req.body.contributors ? JSON.parse(req.body.contributors) : [];
    res.status(201).json(await this.tracks.create(req.userId!, { ...req.body, contributors }, req.file));
  };
  list = async (_req: AuthenticatedRequest, res: Response) => {
    res.json(await this.tracks.list());
  };
  get = async (req: AuthenticatedRequest, res: Response) => {
    res.json(await this.tracks.get(Number(req.params.id)));
  };
  remove = async (req: AuthenticatedRequest, res: Response) => {
    await this.tracks.remove(Number(req.params.id));
    res.status(204).send();
  };
  verify = async (req: AuthenticatedRequest, res: Response) => {
    res.status(201).json(await this.tracks.verify(Number(req.params.id)));
  };
}