# Blockchain 및 외부 결제 연동 계약

현재 구현은 등록 준비와 검증 인터페이스까지다. 네트워크 트랜잭션, NFT 발급, 출금은 전송하지 않는다. 기본 `UnconfiguredBlockchainProvider` / `UnconfiguredPaymentProvider`를 실제 Adapter로 교체하기 전에는 네트워크 성공을 기대하면 안 된다. 설정에 주소/개인키를 채워도 ABI나 실제 Provider가 자동으로 연결되지 않는다.

## 등록 선행 조건

소유자 인증, SHA-256 audioHash, 사용자 지갑 소유권 등록, 정확히 100%의 확정 지분, 최신 VERIFIED/AI 분석(duplicate=false, PASS 또는 WARN), 실제 업로드 검증된 최신 Metadata CID가 필요하다. Mock 분석 또는 로컬 Metadata만 있으면 `POST /api/tracks/:id/register`는 미서명 PREPARATION과 missing 목록을 반환한다. Track은 NOT_REGISTERED로 남아 선행 작업을 완료할 수 있다.

준비 요청은 256bit 랜덤 nonce와 만료 시각을 저장한다. 같은 미서명 요청은 재사용하며 이미 서명한 PENDING 요청은 중복 생성하지 않는다. 만료 요청은 FAILED/EXPIRED로 남기고 새 nonce를 발급한다. 서명된 준비는 Track을 PENDING으로 잠그지만 **전송했다는 뜻은 아니다**(`sent=false`). 서명 발급 후 취소에는 실제 컨트랙트 nonce 취소 기능이 필요하므로 현재 API는 미서명 요청만 취소한다.

## EIP-712 정의

기본 Domain은 name=TrackRegistry, version=1, chainId=31337, verifyingContract=설정된 TrackRegistry 주소다. Primary type은 TrackVerification이다. 모든 이름/버전/chain/address/primary type/필드 순서/지원 타입/해싱 규칙은 환경 설정으로 분리했다.

| 순서 | 필드 | 기본 타입 | 기본 값 및 해싱 |
| --- | --- | --- | --- |
| 1 | audioHash | bytes32 | SHA-256 hex에 0x 추가 |
| 2 | metadataCIDHash | bytes32 | keccak256(UTF-8 CID 문자열) |
| 3 | registrant | address | 소유권 확인된 창작자 지갑 |
| 4 | contributorsHash | bytes32 | 사용자 ID 오름차순으로 역할 지분 합산 후 keccak256(abi.encode(address[],uint256[])) |
| 5 | similarityScore | uint256 | riskScore × 10000, 정수 |
| 6 | modelVersion | string | 분석 모델 버전 |
| 7 | nonce | uint256 | DB unique 랜덤 nonce의 십진 문자열 |
| 8 | deadline | uint256 | 만료 UTC Unix 초 |

지분 정수 기본 scale=100이므로 60%는 6000이고 합계는 10000이다. 주소는 lowercase로 정규화하며 서버가 주소를 만들어 채우지 않는다. array 순서를 재정렬하면 digest가 달라진다.

`EIP712_FIELD_ORDER`는 8개 필드를 정확히 한 번씩 포함해야 한다. `EIP712_FIELD_TYPES_JSON`은 기본 타입에 대한 부분 override다. modelVersion은 string/bytes32(후자는 UTF-8 keccak256), similarityScore는 uint16/32/64/256, deadline은 uint64/256을 지원한다. 해시/주소/nonce 타입은 의미 보존을 위해 각각 bytes32/address/uint256으로 제한한다.

`EIP712_HASHING_JSON`은 다음 부분 설정을 지원한다.

```json
{
  "metadataEncoding": "UTF8",
  "contributorsEncoding": "ABI_ARRAYS",
  "similarityScale": 10000,
  "percentageScale": 100
}
```

metadataEncoding은 UTF8 또는 CID_BYTES(CID 자체 디코딩 bytes의 keccak256), contributorsEncoding은 ABI_ARRAYS 또는 ABI_TUPLES(`tuple(address wallet,uint256 percentage)[]`)다. similarityScale은 10000/100000/1000000, percentageScale은 100/1000/10000/100000/1000000을 지원한다. uint 타입 범위와 scale 충돌을 설정 검증에서 거부한다. 다른 Solidity 인코딩이 필요하면 구현과 fixture를 함께 확장한다.

**최종 ABI와 Solidity 정의를 받은 뒤 Domain, struct 이름, 순서/타입, CID 인코딩, 기여자 정렬/중복 합산, 단위, nonce 소비, deadline 및 digest를 반드시 대조해야 한다. 현재 서명 fixture 통과는 최종 컨트랙트 호환성 증명이 아니다.**

## 환경 구분과 개인키

BLOCKCHAIN_NETWORK는 unconfigured/hardhat/amoy다. 별도 chain override가 없다면 hardhat은 31337, amoy는 80002를 사용한다. `.env.example`의 BLOCKCHAIN_CHAIN_ID=31337을 유지한 채 NETWORK만 amoy로 바꾸지 말고 CHAIN_ID도 80002로 맞추거나 override를 제거한다. 컨트랙트 주소는 해당 chain의 실제 주소여야 한다.

VERIFICATION_SIGNER_PRIVATE_KEY는 환경 변수에서만 읽는다. VERIFICATION_SIGNER_ADDRESS와 유도 주소가 다르면 시작/서명을 거부한다. 키는 API/Metadata/로그에 포함하지 않는다. 실제 전송용 RPC/ABI/수수료/확정 정책은 향후 Adapter에서 추가하며 현재 환경에는 비밀키를 임의로 채워 넣지 않는다.

## 영수증 검증과 상태 갱신

`BlockchainProvider.verifyRegistration(expectation)`은 실제 chain RPC/ABI를 사용해 성공 receipt와 충분한 confirmations를 검사해야 한다. calldata/events를 디코딩해 txHash, chainId, TrackRegistry 주소, registrant, nonce, signed payload digest와 온체인 Track ID를 확인한다. Provider는 기대값을 그대로 복사해 성공을 반환하면 안 된다.

`POST /api/tracks/:id/register/confirm`의 txHash는 조회 힌트일 뿐 증명이 아니다. 소유자, 최신 미만료 요청, 저장된 서명과 현재 입력 digest, REAL source, 확정 수, uint256 Track ID 및 기대값 일치를 서비스가 다시 검사한 후에만 Track/RegistrationRequest를 원자적으로 REGISTERED로 갱신한다. 일치하지 않는 영수증이나 nonce 재사용은 거부한다. 미설정 Provider에서는 503이며 성공 레코드를 만들지 않는다.

Metadata 업로드는 `StorageProvider.upload/verify`와 `MetadataService.upload`의 신뢰 경계다. 실제 저장소에서 내려받은 content/hash를 검증해야 하며 CID 형식 검사만으로 존재나 업로드 성공을 인정하지 않는다. 외부 업로드 결과를 직접 저장하는 클라이언트 API는 제공하지 않는다.

## 라이선스 결제와 ERC-1155

`PaymentProvider.verifyPayment`는 내부 구매 요청을 실제 구매자 지갑/온체인 Track ID/판매 약관/결제 및 NFT 컨트랙트와 매핑해야 한다. 영수증의 자산/통화, 최소 단위 금액, 수령자, token holder, token ID, 성공 상태와 충분한 확정을 검증해야 한다. backend userId/trackId는 on-chain 주소/ID와 혼동하지 않는다.

확인 전 요청은 PENDING_PAYMENT다. 결제만 확인되면 PENDING_MINT이며 수익을 확정하지 않는다. 결제와 mint 둘 다 검증된 REAL 영수증만 License COMPLETED/issuedAt/tokenId와 Purchase COMPLETED를 만든다. paymentReference unique, 구매 잠금, 구매별 Transaction unique, 거래/사용자별 배분 unique로 중복 처리를 막는다. 동일 참조를 다른 구매에 사용하면 트랜잭션 전체를 롤백한다.

Mock은 명시적 PAYMENT_PROVIDER_MODE=mock일 때만 실행한다. 결과는 Purchase SIMULATED, License PENDING_MINT/MOCK, Transaction COMPLETED/MOCK/confirmedAt=null이다. mock: 참조를 사용하고 txHash/tokenId를 생성하지 않는다. 배분은 예상 수익이며 ownershipConfirmed=false다. PREPARATION 구매를 REAL 구매로 바꾸는 것은 금지하며 실제 판매가 가능해진 뒤 새 LIVE 구매를 생성해야 한다.

현재 미결제 요청만 취소할 수 있다. 확인된 결제의 환불/재발급은 실제 컨트랙트 Adapter가 필요하다. 기존 판매 후 새 HOLD 판정은 향후 판매를 중단시키며 과거 영수증을 임의 취소하거나 수익을 수정하지 않는다.

## RevenueSplitter

배분 계산은 Decimal 및 정수 최소 단위를 사용한다. 소수 잔여는 largest remainder 방식으로 분배하고 동률은 userId로 결정해 총액을 보존한다. REAL COMPLETED 거래만 confirmed 수익에 반영하며 Mock은 estimated다. 실제 컨트랙트의 withdrawable balance와 인출 영수증을 확인하는 Adapter는 아직 없다. 따라서 available=0, withdrawalSupported=false이며 출금 요청은 PREPARING만 기록한다.

## 테스트 한계

로컬 테스트는 signature round-trip, 해싱 설정, nonce/만료/영수증 불일치, 결제·mint 순서, 중복 정산 및 Mock 격리를 검증한다. REAL/AI source를 반환하는 Provider도 테스트에서 주입한 고정 fixture이며 실제 AI/IPFS/Hardhat/Amoy/결제 연결을 검증한 것이 아니다. 실제 테스트넷 smoke test와 컨트랙트 golden vector 대조는 외부 연동 단계에서 별도로 수행한다.
