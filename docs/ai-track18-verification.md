# Track 18 실제 AI 연동 결과

## 진단

로컬 `.env`와 `.env.services.local`의 AI_API_URL/TRACK_AI_API_KEY가 일치하고 중복 alias가 없는 것을 확인했다. 토큰 값은 출력하지 않았다. 서비스 실행은 프로세스 환경 → Node --env-file=.env.services.local → dotenv의 .env 순으로 우선한다.

인증된 https://tonight-pos-past-intent.trycloudflare.com/health는 HTTP 200이었다. 실제 Track 18 음원을 file/trackId/requestId multipart로 업로드한 POST /verify는 202를 반환했다. GET /verify/{jobId}는 RUNNING 이후 SUCCEEDED를 반환하고, 실제 결과는 BLOCK/duplicate=true였다. 작업 ID와 trackId, 음원 SHA-256, 결과 스키마, 판정 정책 검증이 모두 통과했다. 프로토콜 호환성을 완화하거나 가짜 PASS를 만들 필요가 없었다.

확인된 저장 장애는 MySQL Verification.riskStatus가 enum('PASS','WARN','HOLD')인 반면, 현재 코드와 Prisma schema에는 BLOCK이 포함되어 있었다는 점이다. prisma generate는 DB 스키마를 변경하지 않는다. 미적용 마이그레이션은 20261105120000_preserve_block_verdict 한 개였다. 기존 서비스는 이 저장 오류까지 AI_ANALYSIS_FAILED로 묶었다. 과거 REJECTED ID 6/7에는 원본 예외가 보존되어 있지 않아 각 과거 요청의 예외를 소급 확정할 수는 없지만, 현재 코드/DB 불일치와 실제 BLOCK 응답은 직접 확인했고, 스키마 적용 후 동일 음원의 저장 성공을 확인했다.

## 백업 및 변경

전체 MySQL을 .local-chain-backups/before-ai-block-1793814036507.sql에 백업했다. 파일 권한은 0600이며 완료 마커와 Verification 스키마 포함 여부, 동반 SHA-256 체크섬을 확인했다. 백업 복원 테스트는 수행하지 않았다. 환경파일과 백업은 gitignore 대상임을 확인했다.

그 뒤 기존 마이그레이션을 적용했다. BLOCK enum을 추가하고, 원본 evidence.decision이 BLOCK인 과거 AI HOLD 2건을 BLOCK으로 정정했다. Track 18의 기존 REJECTED 이력은 수정하지 않았다. DB reset, 체인 재배포, reconcile은 실행하지 않았다.

HTTP Provider에 고정된 안전한 오류 코드를 추가했다. 인증(401/403), 연결, timeout, HTTP 오류, 작업 실패, JSON, 스키마/작업 식별, 음원 해시, 판정 정책, 파일 읽기, 결과 저장 실패를 구분한다. 로그에는 event/trackId/verificationId/code/stage/upstreamStatus만 남기며 원본 예외·응답 본문·키·개인정보·음원은 기록하지 않는다. 세부 코드 목록은 LOCAL_DEVELOPMENT.md를 참조한다.

## 실제 재검증 결과

기존 VerificationService 재검증 정책을 사용했다. Track 18은 NOT_REGISTERED이고 기여도가 확정되어 있으며 활성 PENDING 검증이 없어 새 이력 생성이 허용되었다.

- 인증 health: HTTP 200
- upload: HTTP 202
- poll: 2회, RUNNING → SUCCEEDED
- 새 verification ID: 8
- trackId: 18
- status: VERIFIED
- source: AI
- riskStatus: BLOCK
- duplicate: true
- errorCode: null
- modelVersion: laion/clap-htsat-unfused

VERIFIED는 분석·저장이 완료됐다는 뜻이며 등록 가능 판정이라는 뜻이 아니다. BLOCK에 대한 서명·온체인 등록 준비 자격이 없고 구매도 차단되는 것을 순수 정책 함수로 확인했다. 원본 AI 응답의 similarityScore=null은 evidence에 그대로 보존된다. 정규화된 riskScore=1은 BLOCK의 내부 표현이며 CLAP 유사도 100%를 뜻하지 않는다.

Track 18의 Track 행·기여도·초대, 기존 REJECTED ID 6/7 전체 행, 기존 RegistrationRequest 전체 행, BlockchainIdentity/BlockchainCursor 전체 행을 백업 전 기준과 비교해 동일함을 확인했다. 기존 이력을 삭제하지 않고 새 검증 ID 8만 추가했다. 실제 브라우저 UI 조작이나 온체인 거래 전송은 수행하지 않았다.

## 테스트 및 작업 파일

npm run prisma:generate / npm run build 성공. 최종 npm test: 84개, 80 PASS / 0 FAIL / 4 SKIP. SKIP은 기존 DB/Hardhat 통합 테스트의 opt-in 미지정이다. 실제 서버 연동은 위 별도 실행으로 검증했다.

이번 작업 파일: src/providers/ai.errors.ts, src/providers/http-ai.provider.ts, src/services/verification.service.ts, tests/external-providers.test.cjs, tests/verification-errors.test.cjs, docs/LOCAL_DEVELOPMENT.md, 이 보고서. 기존 마이그레이션 파일은 수정하지 않고 적용만 했다. 이전 작업의 미커밋 변경도 유지했다. 커밋/push/merge는 하지 않았다.

추가 환경변수는 필요하지 않다. 실행 중인 서버가 이전 빌드를 사용한다면 새 코드로 재시작해야 상세 오류 분류가 반영된다.
