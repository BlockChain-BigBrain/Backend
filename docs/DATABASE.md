# Track-AI 데이터베이스

`feature/db-schema`는 DB 구조만 확장한다. API, 외부 Provider, 서명 및 결제 처리는 후속 브랜치 범위다. 기존 인증 경로와 비즈니스 코드는 유지한다.

## 마이그레이션 및 호환성

MySQL **8.0.16 이상**이 필요하다(CHECK 강제 적용). 기존 migration은 수정하지 않았다. 신규 `20261008100000_extend_feature_models`는 테이블/필드/인덱스를 추가하고 금액 컬럼을 Decimal(12,2)에서 Decimal(36,18)로 확장한다. 기존 최대 금액도 손실 없이 보존된다. MySQL DDL은 전체 트랜잭션 롤백이 불가능하므로 적용 전 백업하고 복사본에서 먼저 검증한다.

```sh
npm run prisma:generate
npx prisma validate
# 대상 DATABASE_URL을 확인한 뒤 로컬 DB에 적용
npm run prisma:deploy
npm run build
npm test
```

기존 Track의 해시, 크기, 길이, CID, 온체인 ID는 NULL이며 등록은 NOT_REGISTERED다. 기존 Verification 작업 상태는 유지하되 출처는 UNCONFIGURED, 위험 판정은 NULL이다. 기존 License는 PENDING_PAYMENT로 보수적으로 초기화하며 실제 발급 여부는 별도로 확인해야 한다. 기존 Transaction 상태는 유지하되 confirmedAt은 NULL이므로 COMPLETED만으로 온체인 정산을 신뢰하면 안 된다. 기존 금액 통화는 UNKNOWN으로 보존하며 실제 통화를 확인하기 전 판매/정산에서 제외해야 한다.

## 모델과 관계

| 모델 | 관계 및 추가 데이터 | 삭제 정책 |
| --- | --- | --- |
| User | Track 소유자, Contribution 기여자, License 구매자, Transaction 사용자, 판매자 및 수익 수령자. nullable unique walletAddress | 참조되는 사용자는 RESTRICT |
| Track | SHA-256 audioHash, unsigned BigInt fileSize(바이트), Decimal duration(초), audioCid/metadataCid, 등록 상태/ID/해시, contributionsFinalizedAt | Contribution/Verification/원본 SimilarityResult CASCADE; License/Transaction/Listing이 있으면 RESTRICT |
| Contribution | 동일 Track/User/Role 중복 금지, 역할별 Decimal(5,2) 기여도 | Track CASCADE, User RESTRICT |
| Verification | 작업 상태 PENDING/VERIFIED/REJECTED, 별도 위험 상태 PASS/WARN/HOLD, source UNCONFIGURED/MOCK/AI, duplicate, Decimal riskScore, 모델 버전/확인 시각/오류 | Track CASCADE |
| SimilarityResult | 원본 Track 유지. nullable verificationId/comparedTrackId로 기존 결과 보존, 외부 URL, Decimal score | 원본 Track CASCADE, 검증/비교 Track 삭제 시 SET NULL |
| MarketplaceListing | Track, seller, price, currency, status PREPARING/ACTIVE/INACTIVE, licenseType, 시각 | Track/User RESTRICT |
| License | Track/구매자, PENDING_PAYMENT/PENDING_MINT/COMPLETED/FAILED/CANCELLED, tokenId, purchaseTxHash, issuedAt, 약관 CID, 통화 | Track/User RESTRICT; License 삭제 시 Transaction.licenseId SET NULL(기존 정책 유지) |
| Transaction | Track/User/License, 유형, unique nullable paymentReference, 실패 사유, confirmedAt, 통화 | Track/User RESTRICT; RevenueAllocation 존재 시 삭제 RESTRICT |
| RevenueAllocation | Transaction/User별 unique 배분, 지분 스냅샷, 금액/통화, nullable confirmedAt | Transaction/User RESTRICT |
| RevenueWithdrawal | User, 금액/통화, PREPARING/PENDING/COMPLETED/FAILED/CANCELLED, unique nullable paymentReference, txHash/오류/확인 시각 | User RESTRICT |

외래키는 기본적으로 ON UPDATE CASCADE다. MarketplaceListing.trackId는 CHECK에서 참조하므로 MySQL 제약에 따라 ON UPDATE RESTRICT로 지정했다(판매 이력이 있는 Track 기본키 변경 금지). 주요 조회용 인덱스는 소유자/구매자/사용자+생성 시각, Track+상태, 검증 실행+점수, 공개 판매 상태+통화+가격, 수익 사용자+통화+확인 상태다. audioHash는 재업로드·중복 검증을 위해 non-unique로 둔다. tokenId와 온체인 Track ID는 uint256을 보존하는 문자열이며 향후 chain/contract 식별자 없이 전역 unique로 취급하지 않는다.

## 활성 판매 중복 방지

ACTIVE 생성/전환 시 **같은 원자적 쓰기에서 activeTrackId=trackId**를 지정하고 PREPARING/INACTIVE에서는 NULL로 설정한다. nullable unique 인덱스와 CHECK가 결합되어 동일 음원의 활성 등록을 DB에서 하나로 제한한다. 비활성 이력은 여러 개 보존한다. CHECK는 Prisma Schema로 표현할 수 없으므로 후속 마이그레이션에도 유지해야 한다.

신규 판매/배분/출금은 UNKNOWN 통화를 거부한다. 가격·출금은 양수, 배분액은 0 이상, 배분율은 (0,100], riskScore는 [0,1]이다. 기존 Contribution/SimilarityResult에 범위 CHECK를 새로 적용하지 않아 기존 데이터 때문에 마이그레이션이 실패하지 않게 했다. 후속 서비스에서 기존 데이터 검증 후 제약 강화를 검토한다.

## 후속 기능 구현 시 지켜야 할 조건

- 금액은 Prisma Decimal로 계산한다. KRW 최소 단위 1, USD 0.01, ETH/MATIC 0.000000000000000001이며 서비스에서 자릿수/반올림을 검증한다. API에 BigInt fileSize를 직접 JSON 직렬화하지 말고 문자열로 변환한다.
- 지갑은 실제 사용자 입력을 검증·정규화하며 생성하지 않는다. 역할별 기여는 사용자별로 합산하고 확정 시 정확히 100%를 검증한다.
- riskScore < 0.80 PASS, < 0.90 WARN, 나머지 HOLD다. duplicate와 작업 상태를 구분한다. MOCK은 실제 AI 완료/판매 승인 근거로 사용하지 않는다.
- SimilarityResult의 verification과 원본 track 일치, 판매자의 소유권, 기여도 확정/등록 후 불변성, 중복 검증/구매/nonce 방지는 후속 서비스의 원자적 트랜잭션으로 구현한다. 현재 DB 확장만으로 이 정책들이 구현되었다고 간주하지 않는다.
- 실제 CID/txHash/tokenId를 임의 생성하지 않는다. REGISTERED/License COMPLETED/정산 confirmedAt/출금 COMPLETED는 실제 외부 결과 검증 후에만 기록한다.
- 사용자별 RevenueAllocation unique는 역할이 여러 개인 기여자도 한 번만 정산되도록 한다. confirmedAt이 없는 배분은 예상 수익이며 출금 가능 잔액이 아니다. 출금 준비 상태는 실제 자금 이동을 뜻하지 않는다.

## 격리 DB 회귀 테스트

`tests/database-schema.test.cjs`는 **명시적으로 지정한 폐기 가능한 테스트 MySQL 소켓**만 사용하며 DATABASE_URL을 읽지 않는다. root 계정에 임시 DB 생성/삭제 권한이 필요하다. 고유 테스트 DB를 생성하고 기존 migration → 기존 레코드 fixture → 신규 migration 순으로 적용한 뒤 데이터 보존, Decimal 정밀도, 활성 판매/정산/결제 참조 중복, CHECK, 외래키를 검증하고 테스트 DB를 삭제한다.

```sh
SCHEMA_TEST_MYSQL_SOCKET=/path/to/disposable-mysql.sock npm test
# mysql 실행 파일이 PATH에 없다면 SCHEMA_TEST_MYSQL_BIN도 지정
```

소켓을 지정하지 않은 일반 npm test에서는 DB 테스트를 skip으로 표시한다. 실제 MySQL 8.0 대상 검증 및 운영 데이터 복사본 검증은 별도로 필요하다.

## 변경 및 충돌 범위

변경 파일: prisma/schema.prisma, 신규 migration.sql, tests/database-schema.test.cjs, docs/DATABASE.md. 신규 API 및 Swagger 변경은 없다. 환경 변수 추가도 없다(위 변수는 테스트 전용). 후속 모든 DB 기능 브랜치는 schema.prisma와 migration 이력을 공유하므로 이 변경을 먼저 검토·병합하고 Client를 재생성한다. AI/IPFS/Blockchain/Payment 외부 연동은 아직 미구현이다.
