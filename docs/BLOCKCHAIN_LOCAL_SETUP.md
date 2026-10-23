# Backend ↔ Contract 로컬 실행

실제 연동 대상은 Desktop `Contract`의 TrackRegistry / LicenseMarketplace / LicenseNFT / RevenueSplitter다. 백엔드는 공개 ABI를 자체 저장하고 RPC 영수증을 검증한다. 등록·가격 설정·구매·출금 트랜잭션은 사용자 지갑이 보낸다. 서버에는 검증 서명자 키만 있다. 외부 네트워크 배포는 지원하지 않는다.

## 1. MySQL과 백엔드 준비

Node 24, MySQL, npm이 필요하다. 기존 `.env`의 DB와 Auth 설정은 유지한다. 데이터베이스를 먼저 생성하고 `DATABASE_URL`을 지정한다. 테스트는 별도 socket의 임시 DB를 만들고 삭제한다.

```sh
cd ~/Desktop/Backend-1
npm ci
npx prisma generate
npm run prisma:deploy
```

`prisma:deploy`는 명시한 DB에 신규 migration을 적용한다. 이번 작업의 검증에서는 사용자 `.env` DB에 적용하지 않고 임시 MySQL에서 전체 migration을 재생했다.

## 2. Contract 빌드 및 실제 노드

```sh
cd ~/Desktop/Contract
npm ci
npm run build
npm run typecheck
npm test
npx hardhat node --hostname 127.0.0.1
```

노드 터미널은 실행 상태로 둔다. 다른 터미널에서:

```sh
cd ~/Desktop/Contract
VERIFICATION_SIGNER_ADDRESS=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 npx hardhat run scripts/deploy.ts --network localhost
npm run abi
```

`localhost` HTTP 네트워크를 Contract 설정에 추가했다. `deploy:local`의 기본 simulated network는 명령 종료 시 사라지므로 백엔드 연결에는 위 `--network localhost` 명령을 사용한다. 배포 로그의 마지막 simulated 안내 문구와 달리 localhost 노드는 계속 유지된다. Polygon Amoy 명령은 실행하지 않는다.

## 3. 공개 ABI 및 주소 가져오기

```sh
cd ~/Desktop/Backend-1
node scripts/import-contract.cjs ../Contract http://127.0.0.1:8545
node scripts/setup-hardhat-env.cjs
npm run build
BLOCKCHAIN_ENV_FILE=.env.blockchain.local npm run dev
```

import 도구는 명시한 Contract 경로에서 네 ABI와 `deployments/31337.json`만 읽는다. RPC에서 실제 코드가 존재하는지 확인하고 런타임 코드 해시, genesis 및 배포 이후 anchor 블록을 저장한다. 실행 중 백엔드는 외부 Contract 폴더를 참조하지 않는다. 빌드 시 공개 ABI와 로컬 manifest가 `dist/blockchain`에 복사된다.

`src/blockchain/deployment.json`, `.env.blockchain.local`은 gitignore 대상이다. setup 도구는 **공개적으로 알려진 Hardhat 테스트 계정 #1**을 검증 서명자로 설정하고 키를 파일 권한 0600으로 저장하며 출력하지 않는다. 이 계정을 외부 네트워크에서 사용하지 않는다. 기존 `.env`와 DB/Auth 값을 바꾸지 않는다. `BLOCKCHAIN_ENV_FILE`에는 블록체인 관련 키만 허용한다.

직접 설정할 경우 `.env.example`의 다음 값을 채운다:

- `BLOCKCHAIN_NETWORK=hardhat`, `BLOCKCHAIN_RPC_URL=http://127.0.0.1:8545`, `BLOCKCHAIN_CHAIN_ID=31337`
- `TRACK_REGISTRY_ADDRESS`, `LICENSE_NFT_ADDRESS`, `LICENSE_MARKETPLACE_ADDRESS`, `REVENUE_SPLITTER_ADDRESS`
- `VERIFICATION_SIGNER_ADDRESS`, `VERIFICATION_SIGNER_PRIVATE_KEY`
- `EIP712_DOMAIN_NAME=TrackAI_Registry`, `EIP712_PRIMARY_TYPE=RegisterTrack`, version 1, 기본 필드 순서/타입/해시
- `BLOCKCHAIN_CONFIRMATIONS=2` (automine 테스트는 1 사용), `BLOCKCHAIN_START_BLOCK=0`

Hardhat에서는 Solidity와 다른 EIP712 override를 거부한다. 기본 두 번 확정이면 마지막 거래 후 추가 블록이 필요하다. 테스트 자동화에서 로컬 RPC `evm_mine`으로 한 블록을 추가할 수 있다.

## 4. Health와 등록

```sh
curl http://localhost:4000/api/blockchain/health
```

`connected=true`는 chain ID, 주소, 실제 코드 해시, verifier, marketplace 연결과 배포 블록이 모두 일치한다는 뜻이다. 미설정/실패 시 HTTP 200과 `connected=false`, 진단을 반환한다. 쓰기 준비/confirm은 HTTP 503으로 막는다. Hardhat 재시작 후 재배포하고 import와 build를 다시 실행한다.

Swagger는 `http://localhost:4000/api-docs`에서 확인한다. 기존 회원가입/로그인과 EIP191 지갑 challenge로 창작자·구매자 지갑을 연결한다. 음원을 업로드하고 정수 기여 지분을 확정한다. 같은 사용자의 여러 역할은 합산하며 전체 합은 100이어야 한다. 60%는 on-chain 60이고 6000이 아니다. 실제 검증 AI/PASS·WARN과 검증된 Metadata CID가 필요하다.

1. `POST /api/tracks/:id/registration-payload` 또는 `/register`: EIP712 signature + `transaction`을 받는다.
2. 창작자 지갑이 `{to, data, value: BigInt(value)}`를 전송한다. chainId=31337/from을 확인한다.
3. `POST /api/tracks/:id/registration/confirm`에 `{ "txHash": "0x…" }`를 보낸다.
4. `GET /api/tracks/:id/blockchain`으로 실제 등록 ID/hash/status를 확인한다.

기존 GET registration-payload와 `/register/confirm`은 유지한다. ready=false/missing은 선행 작업이 부족하다는 뜻이다. pending 서명을 같은 내용으로 다시 요청하면 기존 요청을 돌려준다. 서명 만료 전에 실제로 채굴된 영수증은 나중에도 검증할 수 있다. 컨트랙트의 nonce 소비와 calldata digest를 함께 확인한다.

## 5. 가격·구매·NFT

1. 등록 후 `POST /api/market/tracks`에 `{ "trackId":1, "price":"0.01", "currency":"ETH", "licenseType":"COMMERCIAL" }`를 보내 PREPARING listing을 만든다.
2. `POST /api/market/tracks/:id/price-payload`에 `{ "price":"0.01" }`를 보내 창작자 지갑용 `setLicensePrice` calldata를 받는다. **이 id는 listing ID다.**
3. 지갑에서 보내고 `POST /api/market/tracks/:id/price/confirm`에 txHash를 보낸다. 또는 이벤트 catch-up이 처리한다. 최신 on-chain 가격으로 listing을 ACTIVE로 동기화한다.
4. 구매자가 `POST /api/licenses/purchase`에 `{ "trackId":1, "idempotencyKey":"buy-1" }`를 보낸다. 서버가 실제 가격과 판매 정책을 검증하고 `purchaseLicense` calldata와 wei value를 돌려준다.
5. 구매자 지갑이 전송 후 `POST /api/licenses/purchase/confirm`에 `{ "requestId":1, "txHash":"0x…" }`를 보낸다.
6. `/api/users/me/licenses`, `/api/licenses/:licenseId`, `/api/licenses/:licenseId/status`에서 확인한다. 구매 준비 상태는 `/api/licenses/requests/:requestId`다.

현재 실제 계약은 ETH와 COMMERCIAL만 지원한다. 백엔드 INACTIVE는 서버 판매 노출을 중단하며 계약에는 가격 제거/판매 중단 함수가 없다. 이미 정상 채굴된 구매는 이후 listing 상태가 바뀌어도 실제 receipt를 검증해 발급 기록을 동기화한다. tokenId=온체인 trackId이며 ERC1155 1개가 발급된다. 라이선스는 양도 불가다. 확인은 성공 receipt, canonical 블록, confirmations, sender/to/calldata/value, LicensePurchased, LicenseMinted, TransferSingle, NFT balance, RevenueAllocated를 모두 검사한다. 다른 구매자 txHash나 이미 소비된 paymentReference는 거부한다. 표시 단위 ETH와 전송 단위 wei를 구분하며 BigInt/Decimal로 처리한다.

## 6. 수익과 출금

`GET /api/users/me/revenue`는 실제 `getPendingRevenue(wallet)`의 `availableWei`, ETH 표시 값을 반환한다. 거래별 배분은 `/history`에 저장한다. 실제 Splitter는 마지막 기여자를 제외한 지분을 내림하고 마지막 기여자에게 잔여 wei를 배분한다. 101wei의 60:40은 60wei, 41wei다.

`POST /api/revenue/withdraw`에 `{ "idempotencyKey":"withdraw-1" }`를 보내 전체 잔액 출금 calldata를 받는다. 창작자 지갑이 전송한 뒤 `/withdraw/confirm`에 requestId/txHash를 보낸다. 실제 creator/amount/RevenueWithdrawn을 검사한다. 같은 확인은 멱등이며 다른 요청으로 같은 출금 txHash를 재사용할 수 없다. 잔액은 원장 합계 추정이 아닌 on-chain 조회 값이다.

## 7. 이벤트, 재시작 및 복구

서버는 3초마다 확정된 블록을 조회한다. 200블록 배치, durable cursor, chainId/txHash/logIndex unique 원장으로 재시작 후 누락된 범위를 다시 처리한다. 개별 confirm과 listener가 겹쳐도 구매별 Transaction, License, allocation의 unique/잠금으로 중복 생성되지 않는다. 처리 실패는 원장 `error/attempts`에 남고 재시도한다. backend 준비 요청이 없는 외부 거래는 자동으로 사용자/Track을 추측해 생성하지 않고 재시도 상태로 남긴다.

배포 anchor 또는 이미 처리한 cursor 블록 hash가 달라지면 RPC health/처리를 중지한다. 확정 이후 reorg의 자동 금융 롤백은 구현하지 않는다. 로컬 노드 reset 후에는 별도 로컬 DB를 사용하거나, DB 백업을 복원해 해당 배포의 등록/구매/배분/출금 및 cursor/event를 함께 재조정한 뒤 새 manifest를 import하고 서버를 재시작한다. cursor만 삭제해 기존 금융 기록을 새 체인에 섞지 않는다. 이전 정상 블록의 DB 백업과 chain이 일치하면 재조회로 복구 가능하다.

## 8. 실제 통합 테스트

실행 중인 로컬 노드와 import된 배포, 임시 MySQL socket이 필요하다. 기존 `.env` DB를 사용하지 않는다.

```sh
cd ~/Desktop/Backend-1
CHAIN_TEST=1 SCHEMA_TEST_MYSQL_SOCKET=/tmp/track-ai-db-schema.sock SCHEMA_TEST_MYSQL_BIN=/opt/homebrew/bin/mysql npm test
```

`CHAIN_TEST=1` 없이 실행하면 기존 회귀 테스트가 실행되고 blockchain E2E만 skip된다. 테스트는 회원가입·로그인·지갑 소유권·실제 WAV 업로드부터 등록/가격/구매/NFT/배분/출금/DB/event catch-up까지 HTTP와 실제 RPC를 사용한다. 서명 오류/만료/중복 audio/HOLD/미등록/부족 결제/다른 txHash/구매자 replay/중복 이벤트/RPC 장애/code 변경/anchor 불일치를 검사한다. Hardhat 테스트 전용 RPC로 잠시 코드 변경 후 복원하므로 전용 로컬 개발 노드에서 실행한다.

**AI 분석과 IPFS 업로드만 명시적인 TEST-ONLY fixture다. 실제 AI 정확도나 IPFS 파일 가용성을 검증한 것이 아니다.** 기본 AI/IPFS provider는 미설정 상태이며 mock 결과만으로 실제 판매 등록은 허용하지 않는다. 테스트용 fixture를 일반 서버 API나 운영 설정으로 노출하지 않는다.

### Contract .env의 검증자 사용

Contract `.env`의 VERIFICATION_SIGNER_ADDRESS/PRIVATE_KEY를 사용하는 경우, 먼저 그 주소를 검증자로 지정하여 localhost에 배포한다. import 후 다음 명령으로 선택한 키와 새 주소를 Backend overlay에 반영한다. 키 값은 출력되지 않는다.

```sh
node scripts/import-contract.cjs ../Contract
node scripts/setup-hardhat-env.cjs ../Contract/.env
npm run build
BLOCKCHAIN_ENV_FILE=.env.blockchain.local npm run dev
```

인자 없이 setup을 다시 실행하면 기본 Hardhat 테스트 계정을 선택하므로, 사용자 검증자로 배포한 경우에는 반드시 Contract .env 경로를 전달한다. 사용자 DB에 이전 배포의 금융 기록이 있으면 앞의 재배포/복구 절차를 따른다.
