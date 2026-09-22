# Music Rights Backend

Node.js, TypeScript, Express, Prisma, MySQL 기반의 음원 권리 등록 데모 백엔드입니다. 음원은 S3 대신 프로젝트 루트의 `uploads/`에 저장합니다.

## 실행

```bash
cd backend
npm install
cp .env.example .env
# .env의 DATABASE_URL, GOOGLE_CLIENT_ID, JWT_SECRET 설정
npx prisma generate
npx prisma migrate dev --name init
npm run dev
```

## API

- `GET /health`
- `POST /api/auth/google`: `{ "idToken": "Google ID token" }` -> `{ token, user }`
- `GET /api/tracks`
- `GET /api/tracks/:id`
- `POST /api/tracks`: Bearer 인증, `multipart/form-data` (`audio`, `title`, `prompt`, `workLog`, `contributors`)
- `DELETE /api/tracks/:id`: Bearer 인증
- `POST /api/tracks/:id/verify`: Bearer 인증

`contributors`는 JSON 문자열 형식입니다. 예: `[{"userId":1,"role":"PROMPT","percentage":60}]`