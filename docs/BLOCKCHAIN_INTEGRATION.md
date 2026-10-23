# 실제 Contract 연동 규칙

실행 방법은 [BLOCKCHAIN_LOCAL_SETUP.md](BLOCKCHAIN_LOCAL_SETUP.md), 변경·검증 보고는 [BLOCKCHAIN_IMPLEMENTATION.md](BLOCKCHAIN_IMPLEMENTATION.md)를 참조한다.

등록 Domain은 `TrackAI_Registry`, version `1`, chainId `31337`, verifyingContract=실제 TrackRegistry 주소다. 타입은 다음과 같고 순서도 고정이다:

```text
RegisterTrack(bytes32 audioHash,bytes32 metadataCIDHash,address registrant,bytes32 contributorsHash,uint256 similarityScore,string modelVersion,uint256 nonce,uint256 deadline)
```

- audioHash: 업로드 SHA256 32bytes.
- metadataCIDHash: `keccak256(bytes(metadataCID))`, UTF8 문자열.
- registrant: 창작자의 소유권 확인된 지갑. 실제 registerTrack msg.sender와 일치.
- contributorsHash: 사용자별 역할 지분을 합산하고 userId 순서로 `keccak256(abi.encode(address[],uint256[]))`. 정수 지분 합계 100, 60%=60.
- similarityScore: riskScore × 10000. `<8000 PASS`, `<9000 WARN`, 나머지 HOLD.
- modelVersion: string. EIP712이 문자열을 내부 해시한다.
- nonce: DB unique 랜덤 uint256. 컨트랙트는 registrant/nonce 별 단일 소비.
- deadline: UTC Unix 초. 실제 채굴 시 계약이 만료를 검증한다.

서버는 ethers signTypedData로 검증용 서명을 만들고 프론트엔드가 registerTrack tuple/signature를 전송한다. API에 검증 키나 사용자 키를 반환하지 않는다. RPC 영수증에서 calldata digest/nonce/sender/contract와 TrackRegistered·VerificationRecorded를 검증한 후 DB를 REGISTERED로 변경한다.

Marketplace는 creator 또는 명시적 priceManager만 가격을 설정할 수 있다. 구매는 ETH 정확한 값, PASS/WARN만 가능하다. COMMERCIAL ERC1155 tokenId=trackId, 구매자별 1개, 양도 불가다. Splitter는 마지막 기여자가 내림 나머지를 받고 창작자가 자신의 전체 잔액을 직접 출금한다.

`src/blockchain/client.ts`는 코드·배포 블록·계약 연결을 검사한다. `commerce.ts`는 실제 가격/구매/NFT/배분/출금 receipt를 검사한다. `sync.ts`는 durable 이벤트 원장과 확정 블록 cursor를 저장한다. 기존 미설정/Mock Provider 경계는 기본 모드에서 유지하며 실제 모드는 `BLOCKCHAIN_NETWORK=hardhat`으로 명시한다.
