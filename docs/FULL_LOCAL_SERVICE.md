# Track-AI 로컬 실제 서비스 실행

현재 구조는 `TrackRegistry → LicenseMarketplace → LicenseNFT / RevenueSplitter`입니다. 등록은 창작 증명을 저장하고, 구매 시 ERC-1155 상업 이용권을 발급합니다. 예전 `AudioLicense.registerAndMint`와 혼용하지 않습니다.

## 준비

- Node.js 24, Docker Desktop/Compose, Python과 실제 AI 모델 실행 환경
- `Backend`, `Frontend`, `Contract`, `AI` 저장소를 같은 부모 폴더 아래 배치합니다.
- 두 변경 PR의 Backend/Frontend 브랜치를 사용합니다. Contract/AI는 현재 main 규격을 사용합니다.
- AI 저장소의 `api/README.md`에 따라 CLAP 가중치, Chromaprint/fpcalc, ffmpeg, Layer 1 지문 DB와 Layer 2 기준 벡터/manifest를 준비합니다. 이 모델·음원 자산은 GitHub 소스만 받는 것으로 생성되지 않습니다. 기존 AI 담당자의 실행 환경을 사용할 수 있습니다.
- AI 준비가 안 됐거나 검증이 실패하면 등록은 중단됩니다. 대체 점수나 가짜 CID로 진행하지 않습니다.

## 최초 설치

각 저장소에서 `npm ci`를 실행합니다(Backend/Frontend/Contract).

Backend에서:

```bash
npm run local:setup
npm run local:infra
npx prisma generate
npm run local:migrate
```

`local:setup`은 기존 `.env`를 변경하지 않고, Git에서 제외되는 `.env.services.local`에 로컬 DB 비밀번호와 JWT/AI 인증키를 생성합니다. 이미 있으면 덮어쓰지 않습니다. 해당 파일의 `TRACK_AI_API_KEY` 값을 `AI/.env`에도 동일하게 설정하세요. 키를 채팅이나 Git에 올릴 필요는 없습니다.

MySQL은 `127.0.0.1:33306`, Kubo API는 `127.0.0.1:5001`을 사용합니다. 기존 DB/업로드는 자동 삭제하지 않습니다. Compose 볼륨은 재시작 후에도 유지됩니다.

## 실행 — 터미널 4개

1. AI 폴더: 실제 모델 환경에서 `python api/server.py`. `http://127.0.0.1:8000/health`가 `ready`가 될 때까지 기다립니다.
2. Backend 폴더: `npm run local:chain`. Hardhat 노드 시작 → 4개 계약 배포 → ABI/코드 해시/체인 앵커 가져오기 → 로컬 서명자 설정을 수행합니다. 터미널을 유지하세요.
3. Backend 폴더: `npm run dev:services`.
4. Frontend 폴더: `npm run dev -- --host 127.0.0.1`.

브라우저에서 **http://localhost:8443/Frontend/** 로 접속합니다. Backend의 허용 Origin도 `http://localhost:8443`입니다. `127.0.0.1:8443`와 섞어 쓰면 쿠키/Origin이 달라질 수 있습니다.

Backend에서 `npm run local:check`를 실행하면 DB 스키마, AI 준비 상태, IPFS API, 4개 계약 연결을 검사합니다. 네 항목이 모두 READY여야 실제 흐름을 시작할 수 있습니다. 이 검사는 추론이나 민팅 성공을 대신하지 않습니다.

## 브라우저에서 검증

1. 로컬 계정을 만들고 로그인합니다. Google OAuth는 별도 공급자 설정을 넣은 경우에 사용할 수 있습니다.
2. 지갑 확장 프로그램에서 Hardhat 계정을 선택하고 **지갑 연결**로 소유 확인 서명을 합니다. Hardhat #2를 창작자, #3을 공동 창작자, #4를 구매자로 사용할 수 있습니다. #1은 개발용 AI 서명자입니다. 이 계정들은 로컬 개발 전용입니다.
3. 스튜디오에서 WAV/MP3와 제목을 올립니다. 기여도를 비우면 본인 100%입니다. 공동 창작자는 실제 가입 사용자 ID와 정수 퍼센트(합계 100)를 입력하고 각자 지갑을 먼저 연결합니다.
4. **기여도 확정 → AI 검증**. 원래 AI 판정, 원시 점수, 모델·점수·코퍼스 버전, 임계값, 비교 구간을 확인합니다.
5. **IPFS 저장 · 등록**. 음원/메타데이터가 공개 IPFS에 저장되며 재조회한 SHA-256이 일치해야 합니다. 지갑에서 등록을 승인하고 DB 등록 완료를 확인합니다.
6. 로컬 ETH로 판매 가격을 설정합니다. 가격 설정 거래 확인 후 마켓에 공개됩니다.
7. 별도 구매 계정으로 로그인하고 해당 지갑을 연결합니다. 마켓에서 구매를 승인합니다. **라이선스 · 수익**에서 실제 TX와 Token ID를 확인합니다.
8. 창작자 계정으로 돌아와 수익을 출금합니다. 실제 영수증을 확인한 뒤 완료로 표시됩니다.

전송한 거래는 브라우저에 해시와 확인 경로를 저장합니다. 확인 API가 일시적으로 실패하거나 새로고침한 경우 **전송 내역 · 확인 대기**에서 결과만 재확인합니다. 같은 등록·구매를 자동 재전송하지 않습니다. 이미 체인에서 실패한 거래도 성공으로 표시하지 않습니다.

## 판정과 점수

- `audioHash`: 업로드 파일 전체 원본 바이트의 SHA-256. DB는 hex, 계약은 bytes32(`0x` 포함)입니다.
- 실제 AI의 `PASS/WARN/HOLD/BLOCK`, 원시 점수, 모델·정책 버전은 `Verification.evidence`에 보존합니다. 코퍼스 track ID는 내부 MySQL 음원 ID로 오인하지 않고 `externalTrackId`에 저장합니다.
- 계약 점수는 기존 규격 그대로 `0.72 → 7200`, 지분은 `70/30`입니다. AI의 원시 음수 코사인 점수는 증거에 보존하고 계약 위험도에는 0으로 제한합니다. BLOCK은 원시 유사도 null을 보존하고 중복 플래그로 차단합니다.
- AI의 현재 보정 임계값과 계약의 0.80/0.90 임계값은 다릅니다. AI에서 `reviewRequired=true`인 WARN/HOLD는 백엔드 서명과 마켓 활성화를 보류합니다. 검토 승인 기능은 아직 없으므로 이 버전은 자동 진행 가능한 PASS 음원으로 전체 흐름을 검증합니다. 표절 확정으로 표시하지 않습니다.
- 로컬은 자동 채굴 시 확인 대기가 멈추지 않도록 1 confirmation을 사용합니다. 외부 네트워크용 정책이 아닙니다.

## 실제 전체 통합 테스트

Backend 폴더에서(macOS/Linux 또는 Git Bash):

```bash
npm run test:service -- /absolute/path/to/nonduplicate-pass-sample.wav
```

Compose DB/IPFS, AI 모델, Hardhat가 실행 중이어야 합니다. 실제 파일을 AI에 제출하고 실제 IPFS 업로드/재조회 → HTTP 등록 요청 → EIP-712 → 실제 체인 등록 → 가격 설정 → 구매/민팅 → 이벤트 DB 반영 → 출금까지 검사합니다. 테스트는 Compose의 별도 임시 DB를 만들었다가 삭제합니다. 기존 `track_ai` DB는 사용하지 않습니다. 체인 등록과 IPFS pin은 남으므로 같은 음원으로 재실행하려면 Hardhat를 재시작해야 합니다. 테스트 준비에는 로컬 Compose의 root 비밀번호를 사용하지만 서비스는 전용 DB 계정을 사용합니다.

AI가 WARN/HOLD/BLOCK를 반환하면 테스트를 통과시키기 위해 판정을 바꾸지 않습니다. 실제 PASS 샘플로 다시 실행하세요.

`npm test` 기본 실행에서는 외부 DB/체인 테스트가 환경 없을 때 건너뛰어질 수 있습니다. 기본 테스트 통과를 실제 모델 추론·IPFS 통합 통과로 해석하지 마세요.

## 재시작과 한계

Hardhat는 재시작 시 체인 데이터가 초기화됩니다. `local:chain`이 새 배포를 가져온 후 Backend도 재시작해야 합니다. MySQL의 이전 등록 데이터는 자동으로 삭제하지 않으며, 이전 배포에 연결된 음원을 새 체인에서 유효한 등록으로 취급하지 않습니다. 실험용 새 DB/새 음원을 사용하세요.

현재 대상은 사용자 컴퓨터에서 실행하는 로컬 서비스입니다. Amoy/운영 배포, 가스 대납, Google 계정만으로 결제, 검토 승인 워크플로는 포함하지 않습니다. AI 검증 API는 기존 읽기 전용 기준 코퍼스를 사용하며 새 등록 음원을 검색 인덱스에 자동 편입하지 않습니다.
