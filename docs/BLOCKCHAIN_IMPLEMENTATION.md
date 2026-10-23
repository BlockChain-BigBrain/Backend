# Backend ↔ Contract 구현·검증 보고

작업은 Backend `main`에서 진행했다. 원격 push, Amoy/메인넷/클라우드 배포는 실행하지 않았다. 기존 `.env` DB는 수정하지 않았다.

## 1. 구조 분석

Backend는 Express 5 / TypeScript / Prisma 6 / MySQL / ethers 6이며 기존 Auth·Track·Rights 계층을 재사용한다. 기존 blockchain/payment adapter는 미설정 또는 fixture 경계였다. Desktop Contract는 Hardhat 3 + ethers/Mocha + Solidity 0.8.24 + OpenZeppelin 계약이다. 실제 registry 도메인/struct 및 정수 지분 단위가 기존 기본 설정과 달라 수정했다. Solidity 변경은 필요하지 않았고 Contract 설정에 지속 RPC `localhost` 네트워크만 추가했다.

## 2. 실제 함수/이벤트

| 계약 | 연동 함수 | 검증 이벤트 |
| --- | --- | --- |
| TrackRegistry | registerTrack, getTrack, getContributors, getVerification(기존 Contract 테스트), isTrackLicensable, verificationSigner, usedNonces | TrackRegistered, VerificationRecorded |
| LicenseMarketplace | setLicensePrice, getLicensePrice, purchaseLicense, registry, licenseNFT, revenueSplitter | LicensePriceUpdated, LicensePurchased |
| LicenseNFT | balanceOf, hasLicense, marketplace | LicenseMinted, TransferSingle |
| RevenueSplitter | getPendingRevenue, withdrawRevenue, marketplace | RevenueAllocated, RevenueWithdrawn |

가격 권한은 registrant 또는 허용된 priceManager다. 발급 및 배분은 marketplace만 호출한다. 상업용 라이선스만 지원하고 NFT는 양도할 수 없다.

## 3. 변경 파일

신규 핵심 파일:

- `src/blockchain/client.ts`, `commerce.ts`, `sync.ts`, `routes.ts`
- `src/blockchain/abi/{TrackRegistry,LicenseMarketplace,LicenseNFT,RevenueSplitter}.json`
- `src/docs/blockchain.swagger.ts`
- `scripts/{import-contract,setup-hardhat-env,copy-chain-artifacts}.cjs`
- `tests/blockchain-e2e.test.cjs`
- `prisma/migrations/20261009120000_add_blockchain_sync/migration.sql`
- `docs/BLOCKCHAIN_LOCAL_SETUP.md`, 이 보고서

수정: `src/{app,server,config}.ts`, `src/services/{blockchain,license,marketplace,rights.services}.ts`, `src/providers/payment.provider.ts`, `src/routes/rights.routes.ts`, `src/docs/swagger.ts`, schema.prisma, package.json, .env.example, .gitignore, rights-e2e.test.cjs와 관련 기존 문서. Contract 수정은 `hardhat.config.ts`의 localhost HTTP 네트워크와 새 로컬 배포 결과 `deployments/31337.json`이다.

로컬 공개 배포 manifest와 `.env.blockchain.local`은 생성했지만 gitignore 대상이다. 키는 API/로그로 출력하지 않는다.

## 4. API

추가: GET `/api/blockchain/health`, POST `/api/tracks/:id/registration-payload`, POST `/api/tracks/:id/registration/confirm`, POST `/api/market/tracks/:id/price-payload`, POST `/api/market/tracks/:id/price/confirm`, POST `/api/licenses/purchase/confirm`, POST `/api/revenue/withdraw/confirm`.

기존 등록·마켓 목록/상세·구매·수익·출금 API는 hardhat 모드에서 실제 체인 정보/calldata를 사용한다. 기존 register/confirm와 GET registration-payload는 유지한다. 로컬 모드의 `/api/licenses/:id/status`는 발급 라이선스 ID이며 준비 요청은 `/api/licenses/requests/:id`로 구분한다. Swagger에 입력·JWT·반환·오류·wei 예시를 포함했고 전체 schema reference를 검증했다.

## 5. DB

신규 migration만 추가했다. Track.registeredAt, Transaction.chainId/blockNumber, PurchaseRequest.buyerWalletAddress, RevenueWithdrawal.walletAddress를 추가한다. 구매와 출금의 준비 시 지갑을 저장해 나중에 다른 지갑으로 변경되어도 receipt 바인딩을 유지한다.

BlockchainEvent는 chainId/transactionHash/logIndex unique, 계약/이벤트/블록 번호와 hash, JSON payload, 처리 시각/오류/시도 수를 저장한다. BlockchainCursor는 확정 블록 번호/hash를 저장한다. 기존 모델의 transaction/라이선스/배분 unique와 DB row lock을 유지한다. 이전 migration 및 기존 데이터는 보존했다.

## 6. EIP712

Domain=`TrackAI_Registry`, version=`1`, chainId=31337, 실제 registry 주소. 타입 `RegisterTrack`의 8개 필드 순서와 Solidity 타입을 그대로 사용한다. CID는 UTF8 keccak, 기여자는 abi.encode(address[], uint256[]), 지분 합계=100, similarityScore=소수점 점수×10000다. private key/address 매칭, DB unique nonce, 실제 usedNonces, deadline을 검사한다. 실제 컨트랙트가 백엔드 signature를 검증하며 성공했다.

## 7. 구매·NFT

RPC의 실제 가격을 조회해 구매 요청과 일치시킨 뒤 buyer calldata/value를 반환한다. 구매자가 보내고 백엔드가 성공·canonical·확정수·buyer·대상·입력·값과 3개 발급/구매 이벤트 및 balanceOf를 검사한다. 한 구매의 Transaction과 License 생성은 잠금과 unique로 멱등이다. NFT ID/txHash는 실제 RPC 증명에서만 저장한다. 잘못된 txHash와 다른 구매자의 receipt 재사용은 실패했다.

## 8. 수익·출금

실제 RevenueAllocated를 서명된 기여자 순서/지분과 비교한다. 마지막 기여자가 내림 나머지를 받는 Solidity 규칙을 DB에 반영한다. 101wei에서 60/41wei가 실제 체인과 DB에 일치했다. 사용자의 실제 pending balance를 조회하고 full-balance withdrawRevenue calldata를 반환한다. Creator가 전송한 RevenueWithdrawn을 검증하고 한 번만 출금 완료로 저장한다.

## 9. 실제 테스트 결과

- Backend 전체: **52 passed, 0 failed, 0 skipped**. 기존 Auth/Track/rights 회귀 51개 + 실제 Hardhat/MySQL/HTTP 전체 흐름 1개.
- Contract: **51 passed** (Mocha 50 + Solidity revenue conservation fuzz 1, 256 runs).
- Backend/Contract build, Contract TypeScript typecheck, Prisma Client 생성, migration의 기존 데이터 보존 테스트 통과.
- Swagger schema reference 검증 통과. Backend production dependency audit: 0 vulnerabilities.

실제 E2E는 회원가입/로그인/지갑 challenge/WAV 업로드/등록/가격/NFT/배분/출금/DB/event catch-up을 실행했다. signature 오류·만료, 중복 audio, HOLD, 미등록, 부족 결제, 잘못된 txHash, buyer replay, 이벤트 중복, offline RPC, 코드 변경, 배포 anchor 불일치를 검사했다. 자동 catch-up은 confirm 없이 놓친 등록/가격/구매/출금도 동일 receipt 검증 경로로 처리한다. 확인/리스너가 겹쳐도 수익 레코드가 증가하지 않았다.

## 10. 실행 명령과 결과

| 명령 | 결과 |
| --- | --- |
| Contract `npm ci` 최초 | ENOSPC 실패. npm 캐시 정리 후 재실행 성공 |
| Contract `npm run build`, `npx tsc --noEmit`, `npm test` | 성공, 실제 ABI/계약 테스트 51 통과 |
| `npx hardhat node --hostname 127.0.0.1` | localhost 8545 실제 노드 시작 |
| verifier 주소 지정 `npx hardhat run scripts/deploy.ts --network localhost` | 네 계약 로컬 배포 및 marketplace 바인딩 성공 |
| Backend `node scripts/import-contract.cjs ../Contract` | 실제 코드 확인 후 공개 snapshot import 성공 |
| `node scripts/setup-hardhat-env.cjs` | 기존 .env 보존하며 로컬 키/주소 overlay 생성 |
| Prisma migrate diff / generate, `npm run build` | 신규 migration 생성 및 빌드 성공 |
| `CHAIN_TEST=1 SCHEMA_TEST_MYSQL_SOCKET=/tmp/track-ai-db-schema.sock SCHEMA_TEST_MYSQL_BIN=/opt/homebrew/bin/mysql npm test` | 최종 52/52 통과 |
| Swagger reference 검사 | 잘못된 Withdrawal ref 수정 후 전체 참조 정상 |
| `npm audit --omit=dev` | sandbox network 실패 후 승인된 재실행 성공, 0 vulnerabilities |

테스트 후 개발용 네 계약을 새로 배포하고 snapshot/overlay를 갱신했다. 해당 overlay로 health가 connected=true이고 네 계약 모두 true임을 확인했다. 테스트용 MySQL 서버는 종료했다.

테스트에서 폐기 가능한 DB를 생성/삭제했고 실제 사용자의 .env DB에는 migration을 적용하지 않았다. E2E 초기에는 Decimal 과학적 표기와 parseEther 충돌을 발견했고 정밀도 유지 변환을 추가해 재실행했다.

## 11. 범위와 미연동 항목

AI 서버와 실제 IPFS provider는 기존 미설정 상태다. 테스트의 해당 데이터만 TEST-ONLY fixture이며 실제 AI 분석/파일 업로드 성공으로 보고하지 않는다. generic mock API와 실제 체인 proof는 구분한다. 실제 모드는 로컬 Hardhat/ETH/COMMERCIAL만 지원한다.

계약에는 on-chain 판매 중단/가격 제거 함수가 없으며 INACTIVE는 백엔드 판매 노출만 중단한다. 이미 정상 채굴된 구매는 이후 비노출되어도 실제 proof로 동기화한다.

확정 이후 reorg는 자동 금융 롤백 대신 anchor/cursor hash로 탐지해 처리를 중지한다. DB backup/배포 history를 함께 복구한 뒤 재조회하는 수동 복구 절차를 실행 가이드에 명시했다. backend 요청이 없는 외부 온체인 거래는 사용자 ID를 추측하지 않고 원장에 실패/재시도 상태로 남긴다. 프론트엔드 화면은 이 저장소 범위 밖이며 아래 지갑 동작이 필요하다.

## 12. 프론트엔드 할 일

- Creator/Buyer 지갑 연결, chain 31337 전환, EIP191 challenge 서명으로 사용자와 지갑 연결.
- 반환 transaction의 from/to/data/value를 표시하고 사용자 지갑으로 보내기. value는 BigInt(wei string) 사용.
- 등록·가격·구매·출금의 각 txHash를 대응 confirm API에 전달하고 확정 대기/실패/재시도를 표시.
- Track ID, listing ID, on-chain Track/token ID, purchase request ID, issued license ID를 구분.
- WARN 경고, HOLD/duplicate 차단, 18자리 ETH 가격, 구매/NFT/출금 상태 표시.
- 검증 서명용 서버 키를 받거나 사용자 지갑 키를 서버에 전송하지 않기.
