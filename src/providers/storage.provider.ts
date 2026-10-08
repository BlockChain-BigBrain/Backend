import { AppError } from "../utils/errors";
export interface StorageUploadRequest { trackId: number; metadataHash: string; metadata: unknown; audioPath: string; audioHash: string; }
export interface StorageUploadResult { source: "REAL"; metadataHash: string; metadataCid: string; audioCid?: string; }
export interface StorageProvider {
  readonly configured: boolean;
  upload(request: StorageUploadRequest): Promise<StorageUploadResult>;
  verify(request: StorageUploadRequest, result: StorageUploadResult): Promise<boolean>;
}
export class UnconfiguredStorageProvider implements StorageProvider {
  readonly configured = false;
  async upload(_request: StorageUploadRequest): Promise<StorageUploadResult> { throw new AppError(503, "IPFS provider is not configured"); }
  async verify(_request: StorageUploadRequest, _result: StorageUploadResult) { return false; }
}
