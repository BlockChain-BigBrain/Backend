# Music Rights Backend

Node.js, TypeScript, Express, Prisma, MySQL 기반의 음원 권리 등록 데모 백엔드입니다. 음원은 S3 대신 프로젝트 루트의 `uploads/`에 저장합니다.

## 실행

```bash
npm install
cp .env.example .env
# .env의 DATABASE_URL, Google OAuth 설정, JWT 비밀키 2개 설정
npx prisma generate
npx prisma migrate deploy
npm run dev
```

## API

요청·응답 명세는 백엔드의 `/api-docs/`에서 확인할 수 있습니다. 문서 정의는 [Swagger 명세](src/docs/swagger.ts)를 참고하세요.

- `GET /api-docs`: Swagger UI에서 API 문서 확인
- `GET /health`
- `POST /api/v1/auth/signup`: 이메일·비밀번호·닉네임으로 회원가입
- `POST /api/v1/auth/login`: 이메일·비밀번호 로그인
- `GET /api/v1/auth/login/google`: Google 로그인 시작 (브라우저 이동)
- `GET /api/v1/auth/callback/google`: Google 콜백
- `POST /api/v1/auth/refresh`: HttpOnly 쿠키로 `result.accessToken` 발급
- `POST /api/v1/auth/logout`: refresh 쿠키 및 DB 해시 폐기
- `GET /api/v1/auth/me`: Bearer 인증으로 공개 사용자 정보 조회
- `GET /api/tracks`
- `GET /api/tracks/:id`
- `POST /api/tracks`: Bearer 인증, `multipart/form-data` (`audio`, `title`, `prompt`, `workLog`, `contributors`)
- `DELETE /api/tracks/:id`: Bearer 인증
- `POST /api/tracks/:id/verify`: Bearer 인증

`contributors`는 JSON 문자열 형식입니다. 예: `[{"userId":1,"role":"PROMPT","percentage":60}]`

## Google 로그인 설정과 프론트 연동

Google Cloud의 웹 애플리케이션 OAuth 클라이언트에서 클라이언트 ID와 보안 비밀번호를
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`에 입력합니다. 승인된 리디렉션 URI에
`GOOGLE_CALLBACK_URL`과 정확히 같은 주소를 등록합니다.
예: `http://localhost:4000/api/v1/auth/callback/google` (실제 백엔드 PORT에 맞출 것).
클라이언트 보안 비밀번호와 JWT 비밀키는 백엔드에서만 사용합니다.

```js
// 1. 로그인 버튼: fetch가 아닌 브라우저 페이지 이동
window.location.href = 'http://localhost:4000/api/v1/auth/login/google';

// 2. 프론트 /auth/callback 페이지 및 새로고침 시 호출
const response = await fetch('http://localhost:4000/api/v1/auth/refresh', {
  method: 'POST', credentials: 'include',
});
if (!response.ok) throw new Error('다시 로그인해 주세요.');
const { result: { accessToken } } = await response.json();
// accessToken은 메모리에 보관하고 Authorization: Bearer 헤더에 사용합니다.

// 3. 로그아웃 후 프론트의 메모리 토큰도 삭제
await fetch('http://localhost:4000/api/v1/auth/logout', {
  method: 'POST', credentials: 'include',
});
```

프론트에 `/auth/callback`과 `/auth/error` 페이지가 필요합니다.
오류 페이지의 reason은 ACCESS_DENIED, INVALID_STATE 또는 AUTH_FAILED입니다.
`redirectTo`는 같은 프론트 원본의 상대 경로만 허용합니다. 토큰을 URL로 전달하지 않습니다.
Auth 성공 응답은 `{ isSuccess: true, code: "COMMON200", message: "요청에 성공했습니다.", result }`입니다.
로그인·갱신의 result는 `{ accessToken }`, 회원가입·내 정보는 `{ id, email, nickname }`, 로그아웃은 HTTP 200과 `result: null`입니다.
기존 `POST /api/v1/auth/google` ID-token API는 리디렉션 흐름으로 대체했습니다.

Access JWT는 기본 15분, refresh JWT는 기본 14일입니다. `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`으로 변경할 수 있습니다.
`JWT_ACCESS_SECRET`과 `JWT_REFRESH_SECRET`은
각각 `openssl rand -hex 64`로 생성합니다. 비밀번호는 bcrypt(비용 12), refresh JWT는 전체 토큰의 SHA-256 값을 bcrypt(비용 12)로 해싱하여 DB에 저장하며,
매 재발급 시 원자적으로 교체합니다. 새 로그인은 해당 사용자의 이전 refresh token을 무효화합니다.
로그아웃해도 기존 access token은 설정된 만료 시점까지 유효합니다.

`NODE_ENV=production`이면 Secure 쿠키를 강제합니다. 그 외 환경은 `COOKIE_SECURE`를 따릅니다.
Secure refresh 쿠키는 HttpOnly / SameSite=None으로 GitHub Pages와 Render 사이 요청을 지원합니다.
HTTP 로컬 개발에서는 COOKIE_SECURE=false, SameSite=Strict를 사용하고 양쪽 모두 localhost를 사용하세요.
CORS는 FRONTEND_URL에서 추출한 단일 origin에 credentials를 허용합니다. refresh/login/logout은 요청 Origin도 검사합니다.
프론트의 로그인·refresh·logout 요청은 `credentials: "include"`가 필요합니다.
브라우저의 타사 쿠키 차단 정책까지 서버 설정으로 해제할 수는 없습니다. 이 경우 동일 사이트 도메인 구성 등을 별도로 검토해야 합니다.
OAuth state는 10분짜리 서버 메모리와 HttpOnly/Lax 쿠키로 검증합니다.
서버 재시작 시 진행 중인 로그인은 다시 시작해야 하며, 여러 인스턴스 배포 시 공유 세션 저장소가 필요합니다.

기존 DB는 `npx prisma migrate deploy`로 추가 마이그레이션을 적용합니다.
테스트: `npm test` (Google/DB를 대체한 인증 회귀 테스트), 빌드: `npm run build`.

## Swagger에서 Google 로그인 테스트

1. 백엔드 `/api-docs/`에서 Auth → GET /api/v1/auth/login/google을 펼칩니다.
2. 설명의 **Google 로그인 시작하기** 링크를 클릭합니다. Execute로는 Google 인증 화면을 열 수 없습니다.
3. 인증 후 Swagger로 돌아오면 POST /api/v1/auth/refresh → Try it out → Execute를 실행합니다.
4. 응답 accessToken을 복사해 상단 Authorize → access-token에 입력합니다. Bearer 접두사는 제외합니다.
5. GET /api/v1/auth/me → Try it out → Execute로 사용자 정보를 확인합니다.
6. POST /api/v1/auth/logout으로 쿠키를 폐기하고 Authorize → Logout으로 Swagger 토큰도 지웁니다.

프론트 서버 없이 테스트할 수 있습니다. HttpOnly refreshToken Cookie는 브라우저가 자동 전송하며
Authorize에 직접 입력하지 않습니다. 토큰은 문서를 새로고침하면 다시 입력해야 합니다.
첨부본의 Auth API 계약을 현재 Express 구조에 적용했습니다.
기존 `JWT_SECRET`은 `JWT_ACCESS_SECRET`이 없을 때만 호환용으로 사용합니다.
기존 Google 콜백(`/api/auth/callback/google`)은 새 콜백으로 연결하므로 등록된 URI를 변경하는 동안에도 사용할 수 있습니다.
DB 마이그레이션은 기존 Google 계정과 음원 관계를 보존하며 로컬 인증 필드를 추가합니다.
토큰 형식과 해싱 방식이 변경되어 기존 로그인 세션은 다시 로그인해야 합니다.

## 로컬 회원가입 및 로그인

`POST /api/v1/auth/signup` 요청 예시:

```json
{ "email": "fan@example.com", "password": "password123", "nickname": "음악팬", "preferredLanguage": "ko" }
```

비밀번호는 8자 이상·72바이트 이하, 닉네임은 2~20자입니다. 언어는 ko/en/zh 중 하나이며 기본값은 ko입니다.
`POST /api/v1/auth/login`은 `{ "email": "fan@example.com", "password": "password123" }`을 받습니다.
로그인 요청에도 `credentials: 'include'`를 사용합니다. Google 계정과 같은 이메일로 로컬 계정을 만들거나 자동 연결하지 않습니다.
프론트의 기존 Google 로그인 화면은 새 API 계약을 사용합니다. 로컬 로그인은 API와 Swagger에서 사용할 수 있습니다.


로컬 Swagger 예시 계정은 `npm run prisma:seed:example`로 생성합니다.
이메일 `fan@example.com`, 비밀번호 `password123`이며 로그인 API의 Try it out → Execute로 테스트할 수 있습니다.
이 명령은 로컬 개발 DB에서만 실행되며, 기존 계정의 비밀번호를 변경하지 않습니다.

프론트는 Google 로그인 시작·refresh·logout에 `target=frontend`를 보내 전용 `frontendRefreshToken` 쿠키를 사용합니다. Swagger의 기본 `refreshToken` 쿠키는 프론트에서 복원하지 않습니다. 이 변경 후 프론트는 한 번 다시 Google 로그인이 필요합니다.

## JWT 로그인 유지 흐름

Google OAuth의 refresh token은 사용하지 않습니다(`access_type=online`). 자체 JWT refresh token의 해시를 기존 User.refreshTokenHash에 저장합니다.
Access JWT는 사용자 ID를 표준 `sub` 클레임에 담고, 기존 requireAuth가 이를 req.userId로 변환합니다. 이메일은 JWT에서 제거했으며 `/api/v1/auth/me`에서 조회합니다.

1. 프론트는 Google 로그인 시작 URL에 `target=frontend`와 `redirectTo=/Frontend/?login=success`를 전달합니다.
2. callback에서 사용자 확인/생성 및 JWT 쌍 발급 후, refresh token만 HttpOnly 쿠키에 설정하고 프론트로 이동합니다. URL에는 토큰을 넣지 않습니다.
3. 프론트가 `POST /api/v1/auth/refresh?target=frontend`를 credentials 포함으로 호출하면 `{ result: { accessToken } }`을 받습니다. 쿠키도 기존 방식대로 교체됩니다.
4. Access Token은 메모리에 보관하고 Authorization: Bearer 헤더에 넣습니다. 새로고침 또는 만료(401) 시 refresh를 호출한 뒤 원래 요청을 한 번 재시도합니다. refresh 자체가 401이면 재로그인이 필요합니다.
5. `POST /api/v1/auth/logout?target=frontend`는 DB의 refresh 해시를 폐기하고 같은 쿠키 옵션으로 쿠키를 삭제합니다. DB 장애 시에도 브라우저 쿠키는 지우지만 서버 폐기 실패 응답을 유지합니다.

`target` 없는 기존 API/Swagger는 refreshToken 쿠키를 계속 사용합니다. 프론트는 frontendRefreshToken 쿠키를 사용하므로 target을 일관되게 전달해야 합니다.
기존 사용자당 하나의 refresh 해시 및 rotation 구조를 유지합니다. 새 로그인은 이전 세션을 무효화하며 멀티 기기 세션 시스템은 추가하지 않았습니다.
실제 환경 변수가 설정돼 있으면 기본 15분보다 해당 JWT_ACCESS_EXPIRES_IN 값이 우선합니다.
