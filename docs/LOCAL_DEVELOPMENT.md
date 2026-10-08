# 로컬 개발 및 검증

Node.js/TypeScript/Express/Prisma 6/MySQL 구조를 유지한다. 테스트는 Node의 내장 node:test를 사용한다. 클라우드 배포 또는 CI/CD 설정을 추가하지 않았다.

## 실행 순서

1. `npm install`
2. `.env.example`을 참고해 로컬 `.env`를 설정한다. 실제 비밀키는 커밋하지 않는다.
3. 로컬 MySQL **8.0.16 이상**과 DATABASE_URL을 준비한다. 기존 데이터는 먼저 백업한다.
4. `npm run prisma:deploy`로 기존 및 신규 migration을 적용한다.
5. `npm run prisma:generate` / `npx prisma validate`
6. `npm run build` / `npm test`
7. `npm run dev`, `/health`, `/api-docs` 확인

이번 구현에서는 사용자 .env DB를 수정하지 않았다. 신규 마이그레이션은 20261008110000_add_track_visibility 및 20261008120000_add_rights_workflows다. 기존 migration은 유지한다. 서버 코드를 실행하기 전에 로컬 대상 DB에 필요한 migration을 적용해야 한다. MySQL DDL은 완전한 트랜잭션 롤백이 아니므로 복사본에서 먼저 확인한다.

Prisma 개발 의존성의 deepmerge-ts 취약점을 해결하기 위해 @prisma/config 범위 override로 deepmerge-ts 8을 사용한다. Prisma 6 CLI validate/generate/diff 및 실제 migration 테스트로 호환성을 확인한다. `npm audit`도 함께 확인할 수 있다.

## 기본 모드와 Mock 모드

AI_PROVIDER_MODE와 PAYMENT_PROVIDER_MODE의 기본은 unconfigured다. AI 요청은 REJECTED/AI_NOT_CONFIGURED로 실패 기록을 남기고 실제 분석 완료를 만들지 않는다. 결제 reconcile은 503이며 구매 요청을 완료시키지 않는다.

로컬 고정 fixture 흐름을 확인하려면 다음 두 값을 **명시적으로** 지정한다.

```dotenv
AI_PROVIDER_MODE=mock
PAYMENT_PROVIDER_MODE=mock
```

IPFS/Blockchain Provider는 여전히 미설정이다. Mock 점수는 source=MOCK로 저장하며 실제 CID, 등록 txHash, NFT tokenId를 생성하지 않는다. Marketplace는 PREPARING만 가능하고 공개 ACTIVE 판매는 차단된다.

VERIFICATION_TIMEOUT_MS는 기본 30000, 100~60000ms다. timeout은 AI_TIMEOUT으로 실패 기록을 남기고 AbortSignal을 Provider에 전달한다. 중단된 서버의 오래된 PENDING도 다음 요청에서 STALE_PENDING으로 정리한 뒤 재시도한다. 새 PENDING 요청 중복은 409다. 실제 장기 분석은 향후 durable worker/queue와 Provider에 맞춰 조정한다.

## 로컬 사용자 흐름

1. 기존 `/api/v1/auth/signup` / login을 사용한다. 기존 Google OAuth/refresh/logout 경로를 유지한다.
2. `/api/users/me/wallet/challenge`에 본인 지갑 주소를 전달하고 반환 message를 지갑의 `signMessage`로 서명한다. `/api/users/me/wallet`에 signature를 전달한다. 소유권 없는 주소, 만료, replay는 거부한다.
3. MP3/WAV를 업로드하고 contributors CRUD로 역할별 지분을 작성한다. `/contributors/finalize`는 정확히 100%와 실제 등록 지갑을 요구한다.
4. `/verify` 및 `/reverify`로 고정 Mock fixture와 이력/Top-3를 확인한다.
5. `/metadata` preview와 `/metadata/prepare`로 JSON을 생성한다. prompt/workLog는 공개 동의를 명시한 경우에만 포함한다.
6. `/register`와 `/registration-payload`는 부족한 실제 AI/CID/계약/서명 조건을 반환한다. 조건이 없는 상태에서는 최종 서명을 생성하지 않는다.
7. `/api/market/tracks`로 PREPARING 상품을 등록한다. GET 목록의 `scope=mine`으로 본인 준비 상품을 확인한다.
8. 구매자는 `/api/licenses/purchase`에 `preparation:true`를 명시해 준비 구매를 생성한다. 가격은 서버에서 확정한다. Idempotency-Key 또는 idempotencyKey로 재시도를 묶는다.
9. `/api/licenses/requests/:id/reconcile`은 Mock 모드에서 SIMULATED 결과를 생성한다. 실제 소유권은 false이며 NFT ID는 없다.
10. 거래/수익 API로 사용자별 예상 배분을 확인한다. 출금은 PREPARING, available=0이다.

사용자 지갑은 서버가 생성하지 않는다. 프론트 실제 지갑 UI는 아직 연결하지 않았지만 challenge/signature API는 로컬에서 지갑 또는 ethers Wallet로 검증할 수 있다. 기여도 확정/등록 후 주소 변경은 금지한다.

## 테스트 종류

일반 `npm test`는 인증 회귀, 파일/업로드/권한/Range, DTO, 위험 경계, Decimal 단위/잔여 배분, EIP-712, Mock 격리, Swagger를 검사한다. HTTP 테스트에는 루프백 바인딩 권한이 필요하다. DB 소켓이 없다면 3개 DB 테스트는 skip으로 명시한다.

폐기 가능한 MySQL을 직접 준비한 뒤 아래처럼 실행한다. root 계정에 임시 DB 생성/삭제 권한이 필요하다. 아래 변수는 테스트 전용이며 .env.example의 실행 환경과 별개다.

```sh
SCHEMA_TEST_MYSQL_SOCKET=/path/to/disposable-mysql.sock \
SCHEMA_TEST_MYSQL_BIN=/path/to/mysql npm test
```

- database-schema.test: 기존 레코드 fixture 위에 모든 신규 migration 적용, 데이터/통화 unknown 보존, 가격·활성 등록 CHECK 및 외래키.
- track-database.test: 실제 Prisma CRUD, 파일 삭제 복구, 등록/수정 및 동시 삭제 잠금. 기존 test-local-flow.cjs도 격리 DB에서 실행해 실제 로컬 Auth/refresh/logout/업로드/재생을 검사.
- rights-e2e.test: 회원가입→지갑 소유권→업로드→기여도 확정→AI Mock→Metadata→등록/판매 준비→구매 Mock→거래/수익. 예외·Top-3·중복 Pending·timeout·stale 회복·파일 생성 실패·영수증 불일치·만료·발급 대기/실패/취소도 검사.

각 DB 테스트는 고유 DB/파일 디렉터리를 만들고 finally에서 삭제한다. 사용자 DATABASE_URL 대신 명시된 폐기 가능 소켓만 사용한다. E2E의 REAL source 성공 경로도 주입한 테스트 fixture이며 실제 외부 연동 성공을 의미하지 않는다.

`npm run test:local`은 기존 스크립트로 .env의 로컬 DB를 사용하므로 해당 DB에 migration이 적용되어 있어야 한다. production 및 외부 DB 대상 실행은 스크립트가 거부한다.

## 남은 실제 연동

FastAPI /verify transport와 파일 전송, Pinata/IPFS upload 및 content 검증, 최종 Solidity ABI/Domain/hash 정의 대조, 실제 chain receipt Adapter, ERC-1155/결제/환불, RevenueSplitter 잔액/출금은 미연결이다. 구현 계약과 안전한 상태 전환은 [BLOCKCHAIN_INTEGRATION.md](BLOCKCHAIN_INTEGRATION.md), 모델 관계는 [DATABASE.md](DATABASE.md), 전체 API 목록은 [RIGHTS_WORKFLOWS.md](RIGHTS_WORKFLOWS.md)를 참고한다.

## 이번 작업의 실제 검증 결과

- Prisma schema validate / Client generate / TypeScript build 성공.
- 격리 MySQL **9.6**에서 전체 `npm test`: **51 passed, 0 failed, 0 skipped**.
- 기존 Auth/Refresh/Logout 실제 로컬 DB 흐름 및 전체 권리 E2E 포함.
- `npm audit --json`: **0 vulnerabilities**.
- MySQL 8.0 대상 별도 실행 및 실제 AI/IPFS/chain/payment/frontend 연동은 하지 않았다.
- 테스트 DB/파일은 정리했으며 사용자 .env DB는 그대로 유지했다.
