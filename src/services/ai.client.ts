import { readFile } from 'node:fs/promises';

export const AI_POLICY = {
  scoreVersion: 'hybrid_query_top3_pairwise_hold-v5',
  decisionPolicyVersion: 'track-ai-balanced-policy-v5-20261102',
  thresholds: { warn: 0.351229127861893, hold: 0.9471999941293027 },
} as const;

export type AiEvidence = {
  decision: 'PASS' | 'WARN' | 'HOLD' | 'BLOCK';
  audioHash: string;
  modelVersion: string;
  corpusVersion: string;
  scoreVersion: string;
  decisionPolicyVersion: string;
  similarityScore: number | null;
  queryVerifierScore?: number | null;
  durationSeconds: number;
  thresholds: { warn: number; hold: number };
  similarTracks: Array<{ trackId: string; score: number; matchedSegments: Array<{
    queryStartSec: number; queryEndSec: number; refStartSec: number; refEndSec: number; score: number;
  }> }>;
  duplicate: { detected: boolean; matchedTrackId: string | null };
  processingSeconds?: number;
  provisional: boolean;
};
export interface AiGateway {
  submit(filePath: string, originalName: string, trackId: number, requestKey: string): Promise<string>;
  wait(jobId: string): Promise<AiEvidence>;
}
export function isAiEvidence(value: unknown): value is AiEvidence {
  const r=value as AiEvidence | null;
  return !!r && ['PASS','WARN','HOLD','BLOCK'].includes(r.decision)
    && typeof r.audioHash === 'string' && /^[a-f0-9]{64}$/.test(r.audioHash)
    && typeof r.modelVersion === 'string' && typeof r.corpusVersion === 'string'
    && r.scoreVersion === AI_POLICY.scoreVersion && r.decisionPolicyVersion === AI_POLICY.decisionPolicyVersion
    && Number.isFinite(r.durationSeconds) && r.durationSeconds > 0
    && !!r.thresholds && Math.abs(r.thresholds.warn - AI_POLICY.thresholds.warn) < 1e-12 && Math.abs(r.thresholds.hold - AI_POLICY.thresholds.hold) < 1e-12
    && !!r.duplicate && typeof r.duplicate.detected === 'boolean'
    && typeof r.provisional === 'boolean'
    && Array.isArray(r.similarTracks) && r.similarTracks.every(t => t && typeof t.trackId === 'string' && Number.isFinite(t.score) && Array.isArray(t.matchedSegments) && t.matchedSegments.every(s => s && [s.queryStartSec,s.queryEndSec,s.refStartSec,s.refEndSec,s.score].every(Number.isFinite)))
    && (r.decision === 'BLOCK' || (typeof r.queryVerifierScore === 'number' && Number.isFinite(r.queryVerifierScore)))
    && (r.decision === 'BLOCK' ? r.duplicate.detected && typeof r.duplicate.matchedTrackId === 'string'
      : !r.duplicate.detected && typeof r.similarityScore === 'number' && Number.isFinite(r.similarityScore));
}

export class AiClient implements AiGateway {
  private get base() { return (process.env.TRACK_AI_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, ''); }
  private headers() {
    const key = process.env.TRACK_AI_API_KEY;
    if (!key) throw new Error('AI_NOT_CONFIGURED');
    return { Authorization: `Bearer ${key}` };
  }
  async submit(filePath: string, originalName: string, trackId: number, requestKey: string) {
    const headers = this.headers();
    const bytes = await readFile(filePath);
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(bytes)]), originalName);
    form.set('trackId', String(trackId));
    form.set('requestId', requestKey);
    const r = await fetch(`${this.base}/verify`, { method: 'POST', body: form, headers, signal: AbortSignal.timeout(120_000) });
    if (!r.ok) throw new Error(`AI_SUBMIT_${r.status}`);
    const data = await r.json() as { jobId?: unknown };
    if (typeof data.jobId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(data.jobId)) throw new Error('AI_INVALID_RESPONSE');
    return data.jobId;
  }
  async wait(jobId: string) {
    const deadline = Date.now() + 60 * 60_000;
    while (Date.now() < deadline) {
      const r = await fetch(`${this.base}/verify/${encodeURIComponent(jobId)}`, { headers: this.headers(), signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(`AI_POLL_${r.status}`);
      const job = await r.json() as { state: string; result: AiEvidence | null };
      if (job.state === 'FAILED') throw new Error('AI_ANALYSIS_FAILED');
      if (job.state === 'SUCCEEDED') {
        const result = job.result;
        if (!isAiEvidence(result)) throw new Error('AI_INVALID_RESULT');
        return result;
      }
      if (!['PENDING','RUNNING'].includes(job.state)) throw new Error('AI_INVALID_STATE');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('AI_TIMEOUT');
  }
}
