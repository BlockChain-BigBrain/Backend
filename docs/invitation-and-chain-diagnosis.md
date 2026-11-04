# VOCAL 초대 수정 및 로컬 체인 읽기 전용 진단

## 초대 수정

`src/services/invitation.service.ts`의 percentage 검사에 있는 정규식 리터럴이 숫자 패턴을 이중으로 escape하여 `20`까지 거부했다. `/^\d+(\.\d{1,2})?$/`로 수정했다. number/finite/0 초과/100 이하 검사와 합계·예약 기여도·소유자·등록 잠금·수락·확정 정책은 그대로다.

`tests/invitation.test.cjs`에 정상값(20, 10.5, 0.01, 100), 비정상값(0, 음수, 100 초과, 소수점 3자리, 문자열, NaN, Infinity 등), 합계와 수락 및 잠금 정책, 인증된 HTTP 라우터 회귀 테스트를 추가했다. HTTP 테스트는 실제 RightsRoutes/권한 미들웨어/RightsController/InvitationService를 사용하며 저장소만 메모리 fixture다. 프론트엔드와 동일한 VOCAL 20% JSON을 POST하여 201을 확인했다. 실제 서비스 DB에 초대 레코드를 쓰거나 브라우저 UI를 조작하지 않았다.

`npm run prisma:generate`, `npm run build`, `npm test` 성공. 총 79개 중 75 PASS / 0 FAIL / 4 SKIP. SKIP은 기존 MySQL/Hardhat 통합 테스트의 opt-in 조건 미지정 때문이다. 기존 AI 정책, CID/IPFS 및 EIP-712 관련 테스트도 통과했다. AI 인증 오류는 없었다.

## 현재 체인과 DB

점검에는 `npm run local:chain:check`, Prisma findMany(SELECT), eth 조회 및 hardhat_metadata만 사용했다. 앱/worker 시작, reconcile, 마이그레이션, 데이터 수정, 재배포, reset은 실행하지 않았다. check 출력의 `changes`는 도구가 출력하는 계획 설명이며 실행 결과가 아니다.

- RPC: http://127.0.0.1:8545
- chainId: 31337
- 현재 head: 6
- genesis: `0xee57ec70ee7600034abfb1080759e1f70312e85b82aaad65a75cfe86a14dd90a`
- deployment fingerprint: `019e8b92ac9a68919f420ff0864d3a57490e3b95d97d93ee21aed9f5e928d8b6`
- block 6: `0x375f5eb81681d60d99d3996492b0018e2c1a875f7e87bbe4b8aaff17f4058d77`
- TrackRegistry: `0x5FbDB2315678afecb367f032d93F642f64180aa3`
- LicenseNFT: `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`
- LicenseMarketplace: `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9`
- RevenueSplitter: `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0`

현재 DB의 identity/genesis/fingerprint와 RPC가 일치하며, 저장된 identity block과 cursor도 위 block 6과 일치한다. `consistent: true`, `deploymentReady: true`이고 reasons는 비어 있다.

현재 DB에는 Track ID 2~17(16개)이 있고 Track 10~14도 남아 있다. 이들 모두 registrationStatus는 NOT_REGISTERED, registrationTxHash와 blockchainTrackId는 null이다. 현재 RegistrationRequest는 ID 6/7(Track 15/16)의 PENDING 두 건이며 txHash는 null이다. 사용자 제공 당시의 RegistrationRequest ID 1~5는 현재 조회 대상 DB에 없다. 이 차이는 이번 작업에서 수행한 변경이 아니며, 발생 시점/주체는 조회 결과만으로 단정할 수 없다. check의 tracks=2는 전체 Track 수가 아니라 resetPlan이 분류한 체인 연관 Track 수다.

## 이전 백업과 원인

`.local-chain-backups`의 SQL 백업 4개 모두 동반 SHA-256 체크섬과 일치했다.

- before-chain-reset-1793763727906-e2cf2037-5934-475b-bdb4-80138bebb043.sql
- before-chain-reset-1793800847446-19f43b77-40bc-4b5b-b266-e2924580dc6a.sql
- before-chain-reset-1793802145315-c7195bf0-f493-4091-8b86-415fda4d6c9f.sql
- before-chain-reset-1793811642591-ccd9884d-e956-404b-89e3-938bfef73ee3.sql

마지막 백업에 RegistrationRequest ID 1~5 / Track 10~14가 존재한다. 모두 PENDING이고 txHash는 null이다. 이 백업 시점의 Track 10~14도 NOT_REGISTERED였다. 따라서 이 자료만으로 5건의 온체인 등록 완료나 영수증이 있었다고 판단할 수 없다.

마지막 백업의 체인 식별 정보:

- genesis: `0x2f805256e2c28d099e5691282107533466275d337099a7812ce51d9a7ccfc09e`
- deployment fingerprint: `abf8c904a2fbdb3bc799335078640c5f05a323238c1b2f50abf21efed43a0c2a`
- identity/cursor block 6: `0x7ccd166411a7f7ab1d92276c96e9de8307d125e742e53c863cc135b63aeacf85`

다른 백업에도 서로 다른 genesis/anchor hash가 저장되어 있다. 이전 오류 메시지는 DB가 기억하는 체인과 재시작/교체된 RPC 체인이 달랐다는 의미다. chainId나 Hardhat 기본 배포 주소가 같아도 genesis/블록 해시/배포 코드 fingerprint가 다르면 동일 체인이 아니다. 현재는 DB와 RPC가 일치하므로 그 불일치는 재현되지 않는다. 과거 chain 변경/DB 정리 경위는 별도 로그가 없으면 확정할 수 없다.

## 복구 가능성과 안전한 다음 단계

확인한 프로젝트 설정은 EDR simulated Hardhat 노드이고, `scripts/local-chain.cjs`는 시작 시 노드를 띄우고 배포한다. 이전 EVM 상태를 저장/불러오는 로직은 없다. 조사 범위에서 이전 EVM 전체 상태 dump/영속 snapshot은 발견하지 못했다. SQL 백업은 DB 기록이며 EVM 블록·잔액·컨트랙트 storage 복구 파일이 아니다. 다른 위치의 노드 상태 백업이나 이전 노드 프로세스가 확인되지 않는 한 이전 체인 전체 복구 가능성을 입증할 수 없다.

현재 상태에서는 기존 Hardhat 프로세스를 재시작하지 않고 초대/UI 등 오프체인 개발을 계속할 수 있다. 과거 이력 조사가 필요하면 승인 후 원본 SQL을 별도 격리 DB에 복원하여 비교하고, 원본 DB/백업과 현재 체인은 그대로 보존하는 방법이 안전하다. 옛 서명/nonce/deadline을 현재 체인에 재사용하거나 기존 등록을 임의로 완료 처리하면 안 된다. 신규 체인 실험이 필요하면 승인 후 별도 DB·별도 RPC 포트·별도 배포 manifest를 쓰는 환경으로 분리한다. 현 DB를 reset/reconcile하는 방식은 제안하지 않는다.

이번 작업은 로컬 코드 변경만 수행했고 커밋/push/merge는 하지 않았다. 이전 AI 연동 작업의 미커밋 변경도 유지했다.
