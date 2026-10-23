# Track-AI 권리/거래 기능

track-management를 로컬 main에 병합한 뒤 나머지 기능을 main에서 함께 구현했다. 기존 인증/음원 경로와 계층 구조를 유지하며 RightsController/rights.routes/rights.dto, RightsRepository, 기능별 Service, 외부 Provider로 확장한다. Swagger는 모든 신규 API에 입력·권한·응답·오류를 문서화한다.

## API 목록

모든 쓰기는 인증 필수다. 공개 조회 외에는 로그인/소유권 검사를 수행한다.

| 기능 | API |
| --- | --- |
| 지갑 | GET /api/users/me/wallet; POST /api/users/me/wallet/challenge; POST /api/users/me/wallet |
| 기여도 | GET/POST /api/tracks/:id/contributors; PATCH/DELETE /api/tracks/:id/contributors/:contributionId; POST /api/tracks/:id/contributors/finalize |
| 검증 | POST /api/tracks/:id/verify; POST /api/tracks/:id/reverify; GET /api/tracks/:id/verification; GET /api/tracks/:id/verifications |
| Metadata | GET /api/tracks/:id/metadata; POST /api/tracks/:id/metadata/prepare; GET /api/tracks/:id/ipfs |
| 등록 | POST /api/tracks/:id/register; GET /api/tracks/:id/blockchain; GET /api/tracks/:id/registration-payload; POST /api/tracks/:id/register/confirm; POST /api/tracks/:id/register/cancel |
| Marketplace | POST/GET /api/market/tracks; GET/PATCH/DELETE /api/market/tracks/:id |
| License | POST /api/licenses/purchase; GET /api/users/me/licenses; GET /api/licenses/:id; GET /api/licenses/:id/status |
| 구매 요청 | GET /api/licenses/requests/:id; POST /api/licenses/requests/:id/cancel; POST /api/licenses/requests/:id/reconcile |
| 거래/수익 | GET /api/users/me/transactions; GET /api/transactions/:id; GET /api/users/me/revenue; GET /api/users/me/revenue/history; POST /api/revenue/withdraw |

Marketplace :id는 판매 등록 ID다. purchase 응답 id 및 `/licenses/:id/status`의 id는 구매 요청 ID다. `/licenses/:id` 상세 조회는 실제 License ID를 사용한다(구매 요청의 licenseId 또는 보유 목록 id). 발급 전 licenseId는 null이다. 상태 API alias `/licenses/requests/:id`를 사용하면 혼동을 피할 수 있다.

기존 Track 객체/배열 응답과 Auth envelope를 유지한다. 신규 목록은 `{items,total,page,limit}`, 단일 성공은 객체, 오류는 `{error}`다. Auth 오류 envelope는 기존 형식이다. Prisma 충돌은 409, 잘못된 입력은 400, 권한은 401/403, 레코드 없음은 404로 처리하고 DB 상세/비밀은 응답에 노출하지 않는다.

## 핵심 정책

기여도는 동일 사용자/역할 unique이며 동일 사용자의 여러 역할을 합산해 사용자별 총 지분을 만든다. 각 비율 (0,100], 최대 2자리, 작성 중 합계 ≤100, 최종 확정 정확히 100이다. 사용자가 없거나 지갑이 없으면 거부하며 지갑을 임의 생성하지 않는다. 확정/등록 이후 지분 변경은 금지한다. 지갑은 EIP-191 challenge signature로 등록하고 확정 후 변경을 막는다.

Verification 작업 상태와 위험 판정을 분리한다. riskScore는 [0,1], 최대 4자리다. PASS <0.80, WARN <0.90, HOLD ≥0.90이다. duplicate는 Chromaprint 중복 판정, riskScore/status는 CLAP 유사도 판정으로 별개다. 정상/실패/Top-3를 저장하고 재검증 이력을 유지한다. 공개 결과에서는 내부 fingerprint/오류 상세를 제외한다. 검증 시작 시 ACTIVE 판매를 PREPARING으로 내리고, 완료/실패 또는 새로운 HOLD/중복을 이전 판매 승인으로 대체하지 않는다.

Metadata는 지갑/지분·해시·검증 결과를 포함하고 이메일/사용자 비밀은 포함하지 않는다. Prompt/WorkLog는 publish flag와 acceptPublicDisclosure를 명시한 소유자만 추가할 수 있다. 기본은 제외다. SHA-256 내용 해시와 Track별 증가 버전을 기록하며 동일 최신 내용은 재사용한다. 로컬 생성 실패는 FAILED/LOCAL_METADATA_FAILED/localReady=false, 외부 upload 실패는 FAILED/IPFS_UPLOAD_FAILED다. 실패 기록도 생성 요청의 결과로 반환하므로 클라이언트는 HTTP 상태만 보고 성공으로 취급하지 말고 status/localReady를 확인한다.

Track 제목/Prompt/WorkLog가 바뀌면 CID를 무효화한다. 업로드/등록/공개 판매는 최신 document hash와 현재 Track/지분/검증이 일치해야 한다. 실제 upload 결과는 StorageProvider 검증 후에만 저장하며 client supplied CID를 저장하는 API는 없다.

Marketplace는 기본 PREPARING이다. 실제 공개 음원, 최신 VERIFIED/AI PASS 또는 WARN, duplicate=false, REAL REGISTERED 영수증 및 일치하는 Metadata만 ACTIVE로 공개한다. 준비 상품과 Mock은 공개 판매 목록에서 제외한다. 가격은 양수/통화별 자릿수 검증, 가격 범위/가격순 정렬에는 currency를 요구한다. 사용자 본인 준비 목록은 scope=mine이다. 판매 중단은 이력을 삭제하지 않고 INACTIVE로 전환한다.

구매는 판매 정보 가격/통화/유형을 스냅샷으로 고정하고 선택 제공 금액과 비교한다. PREPARING 구매는 preparation=true가 필요하며 LIVE 구매로 전환하지 않는다. 구매 요청/Transaction 생성은 원자적이다. 구매자별 idempotency key 재사용과 활성 구매 unique를 검사한다. 기여자 지분도 구매 시 스냅샷으로 보존한다. 취소/실패 거래는 수익에 반영하지 않는다.

Mock 결제/발급 완료는 SIMULATED이며 License는 PENDING_MINT/MOCK이다. 실제 NFT tokenId/txHash/issuedAt은 없고 ownershipConfirmed=false다. REAL 결제만 확인되면 PENDING_MINT, 실제 mint까지 확인된 뒤에만 COMPLETED다. Provider 결과는 별도의 buyer reconcile/worker 검증 경계에서 받고 API 본문으로 성공 영수증을 주입할 수 없다.

배분은 Prisma Decimal의 80자리 계산과 정수 최소 단위를 사용한다. KRW=1, USD=0.01, ETH/MATIC=10^-18이다. 역할별 합산 후 largest remainder 방식으로 분배해 총액을 보존하며 거래/사용자 unique로 이중 정산을 방지한다. 수익 조회는 estimated/confirmed/available을 구분한다. 현재 실제 RevenueSplitter 잔액 검증이 없어 available=0이고 withdrawalSupported=false다. 출금은 PREPARING 준비 기록만 생성한다.

## DB 변경

신규 migration `20261008120000_add_rights_workflows`는 다음을 추가한다.

- MetadataSnapshot: version/hash/document, PREPARED/UPLOADED/FAILED, 검증된 CID/오류.
- RegistrationRequest: unique nonce, deadline/domain 식별자, typedData/signature, 상태/출처/영수증.
- PurchaseRequest: 가격/지분 스냅샷, 상태/출처, 구매자 idempotency/활성 구매 unique, License/Transaction 관계.
- WalletChallenge: 사용자별 일회용 message/address/nonce/만료/소비 기록.
- License/Transaction.source: UNCONFIGURED/MOCK/REAL. 기존 값은 UNCONFIGURED로 보존.
- Transaction.purchaseRequestId unique(nullable): 기존 거래를 보존하면서 구매 요청별 한 거래를 보장.

기존 User/Auth/Track 데이터와 이전 migration은 유지한다. 새로운 금액 모델은 Decimal(36,18), 구매 가격 양수/UNKNOWN 통화 거부, Metadata version 양수 CHECK를 둔다. 금융/구매 이력은 RESTRICT로 보존하고 Track의 로컬 metadata/등록 준비는 CASCADE 정책이며 서명된 snapshot 참조는 RESTRICT다.

## 파일 및 충돌 범위

추가: src/providers/{ai,storage,blockchain,payment}.provider.ts; src/repositories/rights.repository.ts; src/dto/rights.dto.ts; src/controllers/rights.controller.ts; src/routes/rights.routes.ts; src/services/{contribution,verification,metadata,blockchain,marketplace,license,revenue,transaction,wallet,rights.services}.ts; src/docs/rights.swagger.ts; rights 단위/E2E 테스트; 신규 migration; 이 문서와 LOCAL_DEVELOPMENT/BLOCKCHAIN_INTEGRATION.

수정: schema.prisma, app/config, 기존 Track service, 공통 errors 및 Swagger, package.json/package-lock.json, .env.example, README/DATABASE 문서. 이전 기능 브랜치를 뒤늦게 병합하면 schema/migrations, Track 계층, app/config, Swagger와 package lock에서 충돌할 수 있다. 현재 main을 기준으로 후속 외부 Adapter를 작성한다.

실행/검증은 [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md), 외부 연결 계약은 [BLOCKCHAIN_INTEGRATION.md](BLOCKCHAIN_INTEGRATION.md)를 참조한다. 실제 FastAPI/IPFS와 프론트 지갑 UI는 미완료다. Hardhat chain/ERC1155/RevenueSplitter 실제 연동은 [BLOCKCHAIN_LOCAL_SETUP.md](BLOCKCHAIN_LOCAL_SETUP.md)에 추가했다.
