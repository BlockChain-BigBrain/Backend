# Track 및 파일 관리

`feature/track-management`는 최신 main(`c542899`)에서 진행한다. 기존 Node.js/TypeScript/Express/Prisma/MySQL와 Controller/Service/Repository/DTO 구조 및 인증 경로를 유지한다. AI/IPFS/Blockchain 신규 기능은 구현하지 않는다.

## API

| 메서드 / 경로 | 동작 | 권한 |
| --- | --- | --- |
| POST /api/tracks | multipart `audio`, `title`, 선택 `prompt`, `workLog`, `contributors` JSON, `isPublic` | 로그인 |
| GET /api/tracks | `search`, `sort=createdAt\|title`, `order=asc\|desc`, `page=1`, `limit=20`, `scope=public\|mine` | public은 공개, mine은 로그인 |
| GET /api/tracks/:id | 상세 | 공개 또는 소유자 |
| PATCH /api/tracks/:id | JSON `title`, `prompt`, `workLog`, `isPublic` 중 하나 이상 | 소유자 |
| DELETE /api/tracks/:id | DB 및 로컬 음원 삭제 | 소유자 |
| GET /api/tracks/:id/audio | 전체/단일 bytes Range 재생, `download=true`, HEAD | 공개 또는 소유자 |
| POST /api/tracks/:id/verify | 기존 PENDING 요청 기록 생성 유지 | 소유자 |

신규 API는 PATCH와 audio다. Swagger(`/api-docs`)에 입력·응답·오류를 문서화했다. Track 성공 응답은 기존 객체/배열 형태를 유지하고 오류는 `{ "error": "..." }`다. 목록 배열은 기본 20개로 제한하며 `X-Total-Count`, `X-Page`, `X-Limit` 헤더로 페이지 정보를 제공한다. page는 1~10000, limit은 1~100이며 정렬 동률은 id로 결정한다. 검색은 제목에 대한 MySQL collation 기준 부분 일치다.

## 공개 범위 및 호환성

Track.isPublic Boolean과 `[isPublic, createdAt]` 인덱스를 신규 마이그레이션 `20261008110000_add_track_visibility`로 추가했다. 기존 레코드와 기본 업로드는 **true**로 기존 공개 동작을 유지한다. 비공개 업로드는 multipart `isPublic=false`로 지정한다. 비공개 음원은 공개 목록에서 제외하고 타인의 상세/재생 요청에는 404를 반환한다. 공개 조회에 인증이 필요하지 않지만 제공된 잘못된 토큰은 401로 거부한다.

prompt/workLog는 소유자에게만 반환하며 다른 사용자에게는 null이다. 공개 검증 결과에서 fingerprint, errorMessage, message를 제외한다. 소유자 정보는 id/name/profileImage만 포함한다. 사용자별 응답은 `Cache-Control: private, no-store`로 처리한다.

DB audioPath는 기존 `/uploads/<filename>` 형식을 유지하지만 **응답의 audioPath는 `/api/tracks/:id/audio`**로 변환한다. `/uploads` static 공개는 제거했다. 기존 클라이언트는 응답 URL을 사용해야 한다. 비공개 파일 재생에는 Authorization 헤더가 필요하므로 프론트에서 인증된 fetch 후 Blob/Object URL을 사용하거나 인증 헤더를 지원하는 플레이어를 사용한다. Bearer 토큰을 URL query에 넣지 않는다.

fileSize는 DB에서 BigInt, JSON에서는 바이트 수 문자열이다. duration은 이번 단계에서 계산하지 않는다(null 유지). 기존 음원의 미계산 해시/파일 크기도 자동으로 보충하지 않는다. MP3/WAV 이외에 과거 업로드된 형식은 재생 시 415를 반환한다.

## 업로드와 파일 검증

파일명은 원본 이름과 무관한 UUID + `.audio`다. 저장 위치는 UPLOAD_DIR이며 외부 스토리지는 연결하지 않는다. 기존 MAX_UPLOAD_MB를 사용하며 기본 50MiB, 최대 100MiB다. 소수 MiB는 정수 바이트로 내림하고 최소 1바이트를 요구한다. 환경 변수 추가는 없다.

Multipart는 파일 1개/텍스트 필드 최대 5개/필드당 65535바이트로 제한한다. MIME은 MP3/WAV 계열 또는 application/octet-stream만 허용하며 **최종 MIME은 내용 검사로 결정**한다. WAV는 RIFF 길이, fmt/data chunk, PCM/IEEE float 형식, 채널/샘플레이트/바이트 정렬을 검사한다. MP3는 ID3 헤더와 최소 2개의 연속된 완전한 MPEG Layer III 프레임, 버전/샘플레이트 일치 여부를 검사한다. 손상·잘림·텍스트 위장은 415다. free-format MP3, RF64/압축·extensible WAV는 지원하지 않는다. 이 검사는 구조 검사이며 전체 디코딩/음질 분석은 수행하지 않는다.

검사 및 SHA-256은 제한된 크기의 파일을 메모리에서 읽어 처리한다. 제목은 1~191자, Prompt/WorkLog는 각각 UTF-8 65535바이트까지다. contributors JSON 오류/잘못된 역할·비율/존재하지 않는 사용자/동일 사용자·역할 중복을 거부한다. 같은 사용자의 다른 역할은 허용하며 합계는 Decimal로 100 이하를 검사한다. 기여도 CRUD/최종 확정은 후속 브랜치에서 구현한다.

형식 검사, DTO 검사, DB 저장 실패 시 업로드를 정리한다. Multer 중간 실패도 정리하며 실패 로그는 파일 경로나 비밀 정보를 노출하지 않는다. 실제 파일 접근은 저장 디렉터리의 단일 파일명만 허용하고 traversal과 symlink를 거부한다.

## 변경 및 삭제의 일관성

수정/삭제/기존 검증 요청은 Track 행을 `SELECT ... FOR UPDATE`로 잠근 DB 트랜잭션에서 소유자를 검사한다. PENDING/REGISTERED 또는 온체인 ID/등록 txHash가 있는 음원은 수정·삭제를 409로 거부한다. 원본 파일 교체 API는 제공하지 않는다.

삭제는 파일을 접근 불가능한 `.delete-<uuid>`로 잠시 이동하고 DB 삭제가 실패하면 원래 이름으로 복구한다. DB 커밋 후 임시 파일을 제거한다. License/Transaction/Listing 등 외래키 참조가 있으면 409를 반환하고 원본을 보존한다. 이미 없어진 로컬 파일은 DB 삭제를 막지 않는다.

파일시스템과 DB를 하나의 원자적 트랜잭션으로 묶을 수 없으므로 프로세스 중단 또는 파일 삭제/복구 자체의 실패에는 `.delete-*` 잔여 파일이 생길 수 있다. `track_file_restore_failed` / `track_file_delete_failed` 로그를 확인해 DB audioPath와 대조하여 복구/정리해야 한다. 해당 임시 파일은 API로 접근할 수 없다.

재생은 열린 파일 핸들로 스트리밍하며 연결 종료 시 핸들을 정리한다. 206은 Content-Range/Content-Length를 제공하고 잘못된/다중 Range는 416 및 `bytes */<size>`를 반환한다. If-Range가 제공되면 전체 파일을 반환한다.

## 로컬 실행 및 테스트

기존 .env DB에는 이번 작업에서 마이그레이션을 적용하지 않았다. 백업과 대상 DB 확인 후 로컬에서 다음 순서로 실행한다.

```sh
npm run prisma:deploy
npm run prisma:generate
npx prisma validate
npm run build
npm test
npm run dev
```

`npm test`는 인증 회귀·파일/DTO/권한·업로드 오류 정리·CRUD·Range·Swagger·static 접근 차단을 검증한다. HTTP 테스트는 루프백 서버 바인딩 권한이 필요하다. DB 소켓이 없으면 두 DB 테스트는 명시적으로 skip한다.

폐기 가능한 로컬 MySQL에만 아래 테스트를 실행한다(root 임시 DB 생성/삭제 권한 필요).

```sh
SCHEMA_TEST_MYSQL_SOCKET=/path/to/disposable-mysql.sock \
SCHEMA_TEST_MYSQL_BIN=/path/to/mysql npm test
```

DB 테스트는 고유 임시 DB를 생성하여 모든 migration을 적용하고 종료 후 삭제한다. 사용자 .env의 DATABASE_URL을 사용하지 않는다. 실제 Prisma CRUD/BigInt/검색, 등록 잠금과 수정 경합, 외래키 삭제 실패 시 파일 복구, 동시 삭제를 확인한다. 기존 `scripts/test-local-flow.cjs`도 해당 임시 DB에 대해 실행해 회원가입/로그인/Refresh/Logout/업로드/재생을 검증한다. 기존 `npm run test:local`은 .env의 로컬 DB를 사용하므로 해당 DB에 migration이 적용되어 있어야 한다.

## 수정 파일과 후속 충돌 범위

Track controller/service/repository/routes/DTO, upload/auth middleware, config/app, Swagger와 Track 전용 Swagger, audioFile/trackFiles 유틸, schema와 신규 migration, README/.env.example, tests/track 및 track-database와 공용 fixture, 기존 DB 테스트, docs/DATABASE와 이 문서가 변경 범위다.

후속 Contribution/AI/IPFS 브랜치는 Track 관련 계층·DTO·Swagger·schema에서 충돌할 수 있다. 현재 변경을 먼저 병합하고 후속 작업에서 공개 응답 변환 및 파일 보호 정책을 유지한다. 실제 AI 분석, IPFS, 블록체인 전송/등록, 결제는 미구현이다.

검증 결과: Prisma validate/generate 및 npm run build 성공. 격리 MySQL 9.6에서 DB 테스트와 기존 로컬 인증·업로드 흐름을 포함한 npm test 39개 통과(실패/skip 0). MySQL 8.0 대상 별도 실행은 하지 않았다.
