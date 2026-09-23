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
