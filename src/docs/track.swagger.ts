const trackRef = { $ref: "#/components/schemas/Track" };
const json = (schema: object) => ({ "application/json": { schema } });
const id = { name: "id", in: "path", required: true, schema: { type: "integer", minimum: 1, maximum: 2147483647 } };
const security = [{ "access-token": [] }];
const optionalSecurity = [{}, ...security];
const error = (description: string) => ({ description, content: json({ $ref: "#/components/schemas/TrackError" }) });
const editable = {
  title: { type: "string", minLength: 1, maxLength: 191 },
  prompt: { type: "string", nullable: true, description: "최대 UTF-8 65535바이트. 소유자에게만 반환." },
  workLog: { type: "string", nullable: true, description: "최대 UTF-8 65535바이트. 소유자에게만 반환." },
  isPublic: { type: "boolean", default: true, description: "false이면 소유자만 목록/상세/재생 접근 가능" },
};
export const trackSchemas = {
  TrackError: { type: "object", required: ["error"], properties: { error: { type: "string" } } },
  Track: {
    type: "object", properties: {
      id: { type: "integer" }, ...editable,
      audioPath: { type: "string", example: "/api/tracks/1/audio", description: "권한 확인을 거치는 재생 API. 로컬 파일 경로는 노출하지 않음." },
      mimeType: { type: "string", enum: ["audio/mpeg", "audio/wav"] }, ownerId: { type: "integer" },
      audioHash: { type: "string", nullable: true, minLength: 64, maxLength: 64, description: "SHA-256 hex. 기존 파일은 미계산 시 null." },
      fileSize: { type: "string", nullable: true, pattern: "^[0-9]+$", description: "바이트 수. BigInt를 문자열로 직렬화." },
      duration: { type: "string", nullable: true, description: "초. 이번 단계에서는 계산하지 않음." },
      registrationStatus: { type: "string", enum: ["NOT_REGISTERED", "PENDING", "REGISTERED", "FAILED"] },
      createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" },
      owner: { type: "object", properties: { id: { type: "integer" }, name: { type: "string" }, profileImage: { type: "string", nullable: true } } },
      contributions: { type: "array", items: { allOf: [{ $ref: "#/components/schemas/Contribution" }] } },
      verifications: { type: "array", items: { type: "object" }, description: "상세 및 생성/수정 응답에 포함. 공개 응답에서 fingerprint/오류 상세/메시지 제외." },
    },
  },
} as const;
const failureResponses = {
  "400": error("잘못된 입력"), "401": error("인증 필요 또는 토큰 오류"),
  "403": error("소유자 권한 필요"), "404": error("음원 없음 또는 비공개 접근 불가"),
  "409": error("등록 중/등록 완료 음원 보호 또는 다른 레코드 참조로 변경 불가"),
};
export const trackPaths = {
  "/api/tracks": {
    get: {
      tags: ["Tracks"], summary: "음원 검색 및 페이지네이션", security: optionalSecurity,
      description: "기존 배열 응답 유지. 기본 공개 음원만 조회. scope=mine은 access token 필요. title 검색은 MySQL collation 기준. 정렬 값이 같으면 id로 정렬.",
      parameters: [
        { name: "search", in: "query", schema: { type: "string", maxLength: 191 } },
        { name: "page", in: "query", schema: { type: "integer", minimum: 1, maximum: 10000, default: 1 } },
        { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
        { name: "sort", in: "query", schema: { type: "string", enum: ["createdAt", "title"], default: "createdAt" } },
        { name: "order", in: "query", schema: { type: "string", enum: ["asc", "desc"], default: "desc" } },
        { name: "scope", in: "query", schema: { type: "string", enum: ["public", "mine"], default: "public" } },
      ], responses: {
        "200": { description: "음원 배열", headers: { "X-Total-Count": { schema: { type: "integer" } }, "X-Page": { schema: { type: "integer" } }, "X-Limit": { schema: { type: "integer" } } }, content: json({ type: "array", items: trackRef }) },
        "400": failureResponses["400"], "401": failureResponses["401"],
      },
    },
    post: {
      tags: ["Tracks"], summary: "MP3/WAV 업로드", security,
      description: "PCM/IEEE float WAV 또는 MPEG Layer III MP3(최소 2개 프레임). 파일 내용 검증, SHA-256 저장. 기본 제한 50MiB(MAX_UPLOAD_MB). 원본 파일명 무시. isPublic 기본 true로 기존 공개 동작 유지.",
      requestBody: { required: true, content: { "multipart/form-data": { schema: {
        type: "object", additionalProperties: false, required: ["audio", "title"], properties: {
          audio: { type: "string", format: "binary" }, ...editable,
          contributors: { type: "string", description: "기존 Contribution 배열 JSON. 최대 100개, 역할별 중복 금지, 각 비율 (0,100] 최대 2자리, 합계 ≤100. 확정 기능은 다음 브랜치.", example: '[{"userId":1,"role":"COMPOSER","percentage":100}]' },
        },
      } } } },
      responses: { "201": { description: "생성 성공", content: json(trackRef) }, "400": failureResponses["400"], "401": failureResponses["401"], "413": error("파일 크기 초과"), "415": error("지원하지 않거나 손상된 파일 형식"), "409": failureResponses["409"] },
    },
  },
  "/api/tracks/{id}": {
    get: { tags: ["Tracks"], summary: "음원 상세", security: optionalSecurity, parameters: [id], responses: { "200": { description: "상세. 소유자 외에는 prompt/workLog null", content: json(trackRef) }, "400": failureResponses["400"], "401": failureResponses["401"], "404": failureResponses["404"] } },
    patch: {
      tags: ["Tracks"], summary: "소유자의 음원 정보 수정", security, parameters: [id],
      requestBody: { required: true, content: json({ type: "object", additionalProperties: false, minProperties: 1, properties: editable }) },
      responses: { "200": { description: "수정 성공", content: json(trackRef) }, ...failureResponses },
    },
    delete: { tags: ["Tracks"], summary: "소유자의 음원 및 로컬 파일 삭제", security, parameters: [id], responses: { "204": { description: "삭제 완료" }, ...failureResponses } },
  },
  "/api/tracks/{id}/audio": {
    get: {
      tags: ["Tracks"], summary: "권한 확인 후 음원 재생/다운로드", security: optionalSecurity,
      description: "공개 음원은 공개 재생, 비공개는 소유자만 접근. 단일 bytes Range 지원. HEAD 가능. /uploads 직접 접근은 지원하지 않음.",
      parameters: [id, { name: "download", in: "query", schema: { type: "boolean", default: false } }, { name: "Range", in: "header", schema: { type: "string", example: "bytes=0-1023" } }],
      responses: {
        "200": { description: "전체 파일", content: { "audio/mpeg": { schema: { type: "string", format: "binary" } }, "audio/wav": { schema: { type: "string", format: "binary" } } } },
        "206": { description: "부분 파일", headers: { "Content-Range": { schema: { type: "string" } } } },
        "400": failureResponses["400"], "401": failureResponses["401"], "404": failureResponses["404"],
        "415": error("지원하지 않는 기존 음원 형식"),
        "416": { description: "지원하지 않거나 유효하지 않은 Range", headers: { "Content-Range": { schema: { type: "string", example: "bytes */1000" } } } },
      },
    },
  },
  "/api/tracks/{id}/verify": {
    post: { tags: ["Tracks"], summary: "기존 검증 요청 기록 생성", description: "소유자만 PENDING 요청 생성. 실제 AI 분석은 아직 미구현.", security, parameters: [id], responses: { "201": { description: "PENDING 생성" }, ...failureResponses } },
  },
} as const;
