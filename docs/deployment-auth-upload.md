# GitHub Pages / Render 연동

- 실제 프론트 소스: 옆 `Frontend` 저장소. 이 저장소의 `frontend/`와 기존 `frontend-google-auth.patch`는 이전 시제품입니다.
- Render: `FRONTEND_URL=https://blockchain-bigbrain.github.io`, `COOKIE_SECURE=true`.
- `GOOGLE_CALLBACK_URL`은 Google Cloud에 등록된 HTTPS 콜백과 일치해야 합니다. 기존 `/api/auth/callback/google`도 지원합니다.
- CORS는 FRONTEND_URL의 origin만 사용합니다. 허용된 Origin의 교차 사이트 인증 요청은 허용하고 다른 Origin은 거부합니다.
- HTTPS refresh 쿠키는 HttpOnly / Secure / SameSite=None입니다. 타사 쿠키를 차단하는 브라우저에서는 세션 복원이 제한될 수 있습니다.
- 프론트는 Vite BASE_URL(`/Frontend/`)을 OAuth redirectTo에 전달하므로 GitHub Pages에 존재하지 않는 `/auth/callback` 페이지가 필요하지 않습니다.
- 업로드는 공유 인증 클라이언트로 POST /api/tracks에 Bearer 토큰, audio 파일, 파일명에서 만든 title, prompt, workLog를 전송합니다. 프로젝트 파일 첨부는 서버에서 지원하지 않아 명시적으로 안내합니다.
- 백엔드와 프론트 모두 배포해야 적용됩니다. 프론트 `npm run build`는 GitHub Pages용 docs를 생성합니다.
- 실제 Google 로그인, 새로고침 후 세션 복원, 음원 업로드는 양쪽 배포 후 브라우저에서 확인해야 합니다.

## DB 및 로컬 통합 테스트

- `npm run test:local`: 로컬 MySQL에서 임시 사용자 생성, 비밀번호 로그인, 인증된 WAV 업로드, 파일 다운로드, 공개 목록/상세 조회, refresh 및 logout을 실제 HTTP로 검사합니다. 테스트 데이터는 정리합니다. 원격 DB/production에서는 실행을 거부합니다. Google 계정 인증은 기존 모킹 테스트와 구분됩니다.
- `npm run db:check`: 배포 빌드 후 연결, 음원 테이블, 인증 컬럼, 음원 관계 조회를 읽기 전용으로 점검합니다. URL/자격 증명/조회 레코드는 출력하지 않습니다.
- 로컬 DB 정상 여부는 Render DB 정상 여부를 보장하지 않습니다. Render에서 `loopback:true`라면 DATABASE_URL이 Render 컨테이너 자체를 가리키므로 실제 접근 가능한 MySQL 주소로 수정해야 합니다.
- `P1001`이면 DB 접근/호스트/방화벽, `P1000`이면 DB 인증, `P2021`/`P2022`이면 배포 DB의 마이그레이션 상태를 확인합니다. 스키마 누락으로 확인된 경우 대상 DB를 확인한 뒤 `npm run prisma:deploy`로 기존 마이그레이션을 적용합니다. reset/db push는 사용하지 않습니다.
