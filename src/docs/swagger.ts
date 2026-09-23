const authResponse = (result: object) => ({ type: "object", properties: {
  isSuccess: { type: "boolean", example: true }, code: { type: "string", example: "COMMON200" },
  message: { type: "string", example: "요청에 성공했습니다." }, result,
} });
const credentials = { email: { type: "string", format: "email", example: "fan@example.com" }, password: { type: "string", format: "password", maxLength: 72, example: "password123" } };

export const swaggerSpec = {
  openapi: "3.0.3",
  info: {
    title: "Track AI Backend API",
    version: "0.1.0",
    description: "음원 등록 및 권리 관리를 위한 백엔드 API. Auth에서 Google OAuth 로그인, 토큰 재발급, 로그아웃 및 사용자 조회를 확인할 수 있습니다.",
  },
  servers: [{ url: "/", description: "Current server" }],
  tags: [
    { name: "Health", description: "서버 상태" },
    { name: "Auth", description: "Google 로그인" },
    { name: "Tracks", description: "음원 등록 및 관리" },
  ],
  components: {
    securitySchemes: {
      "access-token": { type: "http", scheme: "bearer", bearerFormat: "JWT", description: "refresh 응답의 accessToken만 입력합니다. Bearer 접두사는 자동 적용됩니다." },
      "refresh-token": { type: "apiKey", in: "cookie", name: "refreshToken", description: "Google 로그인 시 서버가 설정하는 HttpOnly Cookie. 수동 입력하지 않으며 브라우저가 전송합니다." },
    },
    responses: {
      Unauthenticated: {
        description: "인증 토큰이 없거나 유효하지 않습니다.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" }, example: { isSuccess: false, code: "COMMON401", message: "Invalid or expired token", result: null } } },
      },
      Forbidden: {
        description: "허용되지 않은 요청 Origin입니다.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" }, example: { isSuccess: false, code: "COMMON403", message: "Untrusted request origin", result: null } } },
      },
    },
    schemas: {
      TokenResponse: authResponse({ type: "object", required: ["accessToken"], properties: { accessToken: { type: "string", description: "JWT_ACCESS_EXPIRES_IN 동안 유효한 access JWT", example: "eyJhbGciOiJIUzI1NiJ9.example.signature" } } }),
      ErrorResponse: { type: "object", properties: { isSuccess: { type: "boolean", example: false }, code: { type: "string" }, message: { type: "string" }, result: { nullable: true, example: null } } },
      User: authResponse({
        type: "object",
        properties: {
          id: { type: "integer", example: 1 },
          email: { type: "string", format: "email", example: "user@example.com" },
          nickname: { type: "string", example: "홍길동" },
        },
      }),
      Contribution: {
        type: "object",
        required: ["userId", "role", "percentage"],
        properties: {
          userId: { type: "integer", example: 1 },
          role: { type: "string", enum: ["PROMPT", "EDIT", "COMPOSER", "VOCAL", "PRODUCER", "OTHER"] },
          percentage: { type: "number", format: "float", example: 60 },
        },
      },
      Track: {
        type: "object",
        properties: {
          id: { type: "integer", example: 1 },
          title: { type: "string", example: "Demo Track" },
          prompt: { type: "string", nullable: true },
          workLog: { type: "string", nullable: true },
          audioPath: { type: "string", example: "/uploads/1727000000000-demo.mp3" },
          mimeType: { type: "string", example: "audio/mpeg" },
          ownerId: { type: "integer", example: 1 },
        },
      },
    },
  },
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "서버 상태 확인",
        responses: { "200": { description: "서버 정상", content: { "application/json": { schema: { type: "object", properties: { status: { type: "string", example: "ok" } } } } } } },
      },
    },
    "/api/v1/auth/signup": {
      post: { tags: ["Auth"], summary: "로컬 회원가입", requestBody: { required: true, content: { "application/json": { schema: {
        type: "object", additionalProperties: false, required: ["email", "password", "nickname"], properties: {
          ...credentials, password: { ...credentials.password, minLength: 8, description: "최대 72바이트" },
          nickname: { type: "string", minLength: 2, maxLength: 20, example: "음악팬" }, preferredLanguage: { type: "string", enum: ["ko", "en", "zh"], default: "ko" },
        },
      } } } }, responses: {
        "201": { description: "회원가입 성공", content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } } },
        "400": { description: "입력 오류" }, "409": { description: "이미 가입된 이메일" },
      } },
    },
    "/api/v1/auth/login": {
      post: { tags: ["Auth"], summary: "로컬 로그인", requestBody: { required: true, content: { "application/json": { schema: {
        type: "object", additionalProperties: false, required: ["email", "password"], properties: credentials,
      } } } }, responses: {
        "200": { description: "로그인 성공. refreshToken HttpOnly Cookie 설정", content: { "application/json": { schema: { $ref: "#/components/schemas/TokenResponse" } } } },
        "400": { description: "입력 오류" }, "401": { $ref: "#/components/responses/Unauthenticated" }, "403": { $ref: "#/components/responses/Forbidden" },
      } },
    },
    "/api/v1/auth/login/google": {
      get: {
        tags: ["Auth"], summary: "Google OAuth 로그인 시작", operationId: "startGoogleOAuth",
        description: "[Google 로그인 시작하기](/api/v1/auth/login/google?target=swagger)\n\n위 링크를 브라우저에서 열어 로그인합니다. Google 인증 화면은 리다이렉션 방식이므로 Try it out의 Execute로 로그인할 수 없습니다. 인증 후 이 문서로 돌아오면 POST /api/v1/auth/refresh를 실행하세요.",
        parameters: [
          { name: "redirectTo", in: "query", description: "로그인 후 이동할 프론트 상대 경로", schema: { type: "string", default: "/auth/callback" } },
          { name: "target", in: "query", description: "swagger를 지정하면 로그인 후 API 문서로 복귀합니다.", schema: { type: "string", enum: ["swagger"] } },
        ],
        responses: {
          "302": { description: "Google 인증 페이지로 이동. OAuth state Cookie를 설정합니다.", headers: { Location: { schema: { type: "string" }, description: "Google 인증 URL" } } },
          "503": { description: "OAuth 설정 누락 또는 로그인 요청 과다" },
        },
      },
    },
    "/api/v1/auth/callback/google": {
      get: {
        tags: ["Auth"], summary: "Google OAuth 콜백", operationId: "completeGoogleOAuth",
        description: "Google이 code와 state를 전달하는 콜백입니다. 직접 호출하지 않습니다. 인증 성공 시 refreshToken HttpOnly Cookie를 설정하고 프론트 콜백 또는 Swagger로 이동합니다. access token은 URL에 포함하지 않습니다. 실패 시 reason 또는 login 파라미터로 ACCESS_DENIED, INVALID_STATE, AUTH_FAILED를 전달합니다.",
        parameters: [
          { name: "code", in: "query", description: "Google이 발급한 일회용 authorization code (인증 성공 시)", schema: { type: "string" } },
          { name: "state", in: "query", description: "로그인 시작 시 발급한 CSRF 검증 값", schema: { type: "string" } },
          { name: "error", in: "query", description: "Google 인증 거부/실패 코드", schema: { type: "string", example: "access_denied" } },
        ],
        responses: { "302": { description: "로그인 결과 페이지로 이동. 성공 시 refreshToken Cookie 설정", headers: {
          Location: { schema: { type: "string" }, description: "프론트 콜백 또는 /api-docs/" },
          "Set-Cookie": { schema: { type: "string" }, example: "refreshToken=<token>; Path=/api/v1/auth; HttpOnly; Secure; SameSite=None" },
        } } },
      },
    },
    "/api/v1/auth/refresh": {
      post: {
        tags: ["Auth"], summary: "Access token 재발급", operationId: "refreshAccessToken",
        security: [{ "refresh-token": [] }],
        description: "Google 로그인 후 Try it out → Execute로 실행합니다. 요청 본문은 없습니다. 브라우저가 refreshToken Cookie를 보내면 새 accessToken을 반환하고 refresh Cookie를 교체합니다. 응답의 accessToken을 복사해 상단 Authorize → access-token에 입력한 뒤 인증 API를 테스트하세요. HttpOnly Cookie는 Authorize에 수동 입력하지 않습니다.",
        responses: {
          "200": { description: "재발급 성공. 기존 refresh token은 무효화됩니다.", headers: { "Set-Cookie": { schema: { type: "string" }, description: "교체된 refreshToken HttpOnly Cookie" } }, content: { "application/json": { schema: { $ref: "#/components/schemas/TokenResponse" } } } },
          "401": { $ref: "#/components/responses/Unauthenticated" }, "403": { $ref: "#/components/responses/Forbidden" },
        },
      },
    },
    "/api/v1/auth/logout": {
      post: {
        tags: ["Auth"], summary: "로그아웃", operationId: "logout",
        security: [{ "refresh-token": [] }],
        description: "DB의 refresh token 해시와 브라우저 Cookie를 폐기합니다. 요청 본문은 없습니다. 쿠키가 없어도 성공합니다. Swagger에 입력한 access token은 Authorize → Logout으로 별도 삭제하세요. 기존 access token은 만료 시점까지 유효합니다.",
        responses: { "200": { description: "로그아웃 성공. refreshToken Cookie 삭제", content: { "application/json": { schema: authResponse({ nullable: true, example: null }) } } }, "403": { $ref: "#/components/responses/Forbidden" } },
      },
    },
    "/api/v1/auth/me": {
      get: {
        tags: ["Auth"], summary: "로그인 사용자 조회", operationId: "getMe",
        security: [{ "access-token": [] }],
        description: "Authorization: Bearer <accessToken>으로 현재 로그인한 사용자의 공개 정보를 조회합니다.",
        responses: {
          "200": { description: "조회 성공", content: { "application/json": { schema: { $ref: "#/components/schemas/User" }, example: { isSuccess: true, code: "COMMON200", message: "요청에 성공했습니다.", result: { id: 1, email: "user@example.com", nickname: "홍길동" } } } } },
          "401": { $ref: "#/components/responses/Unauthenticated" },
        },
      },
    },
    "/api/tracks": {
      get: {
        tags: ["Tracks"],
        summary: "Track 목록 조회",
        responses: { "200": { description: "Track 목록" } },
      },
      post: {
        tags: ["Tracks"],
        summary: "음원 업로드 및 Track 생성",
        security: [{ "access-token": [] }],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["audio", "title"],
                properties: {
                  audio: { type: "string", format: "binary" },
                  title: { type: "string" },
                  prompt: { type: "string" },
                  workLog: { type: "string" },
                  contributors: { type: "string", description: "Contribution 배열 JSON 문자열" },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Track 생성 성공" }, "400": { description: "입력값 또는 파일 오류" }, "401": { description: "인증 필요" } },
      },
    },
    "/api/tracks/{id}": {
      get: {
        tags: ["Tracks"],
        summary: "Track 상세 조회",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { "200": { description: "Track 상세 정보" }, "404": { description: "Track 없음" } },
      },
      delete: {
        tags: ["Tracks"],
        summary: "Track 및 로컬 음원 삭제",
        security: [{ "access-token": [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { "204": { description: "삭제 성공" }, "401": { description: "인증 필요" }, "404": { description: "Track 없음" } },
      },
    },
    "/api/tracks/{id}/verify": {
      post: {
        tags: ["Tracks"],
        summary: "Track 검증 요청",
        security: [{ "access-token": [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { "201": { description: "검증 요청 생성" }, "401": { description: "인증 필요" } },
      },
    },
  },
} as const;