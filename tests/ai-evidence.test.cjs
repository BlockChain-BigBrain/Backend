const { test } = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/ai-precision-evidence.json');
const { normalizeAiEvidence, aiRequiresReview } = require('../dist/providers/http-ai.provider');

test('real supplemental WARN keeps policy, AI scope and three matching fragments', () => {
  const result = normalizeAiEvidence(structuredClone(fixture), fixture.audioHash);
  assert.equal(result.evidence.decision, 'WARN');
  assert.equal(aiRequiresReview(result.evidence), true);
  assert.equal(result.evidence.referenceTracks, 34);
  assert.equal(result.evidence.pureAiCreationVerified, false);
  assert.match(result.evidence.scoreVersion, /secondary-clap-cqt-fragments-v1/);
  assert.equal(result.evidence.similarTracks[0].matchedSegments.length, 3);
  assert.equal(result.similarTracks[0].externalTrackId, fixture.similarTracks[0].trackId);
});
test('invalid or unbounded segment evidence is rejected before persistence', () => {
  for (const patch of [{ queryStartSec: -1 }, { queryEndSec: NaN }, { refEndSec: -1 }, { score: 2 }, { queryEndSec: fixture.durationSeconds + 2 }]) {
    const raw = structuredClone(fixture); Object.assign(raw.similarTracks[0].matchedSegments[0], patch);
    assert.throws(() => normalizeAiEvidence(raw, raw.audioHash), /matching segment/);
  }
  const raw = structuredClone(fixture); raw.similarTracks[0].matchedSegments = Array(13).fill(raw.similarTracks[0].matchedSegments[0]);
  assert.throws(() => normalizeAiEvidence(raw, raw.audioHash), /Too many/);
});
test('AI scope and creation metadata cannot silently lose their types', () => {
  for (const patch of [{ evaluationScope: 'all-ai-verified' }, { referenceTracks: 0 }, { pureAiCreationVerified: 'true' }, { durationSeconds: NaN }]) {
    const raw = { ...structuredClone(fixture), ...patch };
    assert.throws(() => normalizeAiEvidence(raw, raw.audioHash));
  }
});
