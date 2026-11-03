# AI v5 연동 정책

이 브랜치는 Backend `origin/main`의 최신 커밋(`f62c0f9`)에서 분기해, 2026-11-02에 잠근 AI 모델 정책을 반영한 연동 브랜치입니다. `main`에는 직접 변경하지 않았습니다.

## 판정 계약

- `scoreVersion`: `hybrid_query_top3_pairwise_hold-v5`
- `decisionPolicyVersion`: `track-ai-balanced-policy-v5-20261102`
- `modelVersion`: `laion/clap-htsat-unfused`
- `WARN`: `queryVerifierScore >= 0.351229127861893`
- `HOLD`: `similarityScore >= 0.9471999941293027` (pairwise temporal score)
- `PASS`: 위 두 조건 미충족
- `BLOCK`: Layer 1 Chromaprint exact duplicate

WARN와 HOLD는 같은 점수 구간이 아닙니다. WARN은 query-level top-3 verifier 점수, HOLD는 최종 pairwise temporal 점수를 사용합니다. HOLD는 자동 소유권 확정이 아니라 수동 검토가 필요한 보류 상태입니다.

## API 응답 필수 필드

`isAiEvidence()`는 다음 메타데이터를 검증합니다.

- `scoreVersion`, `decisionPolicyVersion`, `modelVersion`
- `thresholds.warn`, `thresholds.hold`
- `similarityScore`, `queryVerifierScore`, `provisional`
- `matchedSegments[]`의 수치형 시간/정렬 필드

정책 버전·임계값이 다르거나 `provisional`이 누락된 오래된 응답은 증거로 취급하지 않습니다.

## 런타임 설정

- `TRACK_AI_URL`: AI API base URL
- `TRACK_AI_API_KEY`: AI API 인증 키

프론트엔드와 블록체인 기록 계층도 위 버전 문자열과 임계값을 동일하게 사용해야 합니다. 모델 임베딩의 cosine은 후보 검색에 사용되며, 최종 판정은 pitch/rhythm/chroma 및 시간 일관성 검증을 포함한 파생 점수로 수행됩니다.

## 검증 상태

AI client 단위 테스트 fixture와 레거시 정책 거부 테스트를 추가했습니다. 전체 Backend build는 최신 `main`에 이미 존재하는 `ethers` 누락 및 Prisma schema/generated-client 불일치로 중단됩니다. 해당 오류는 이번 AI client 변경에서 발생한 것이 아니며, 별도 Backend 정합성 작업이 필요합니다.
