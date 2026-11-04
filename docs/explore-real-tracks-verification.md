# Explore 실제 음원 검증 (2026-11-04)

- 기존 design-v3의 헤더, 통계 영역, 검색/필터 및 카드 그리드를 유지하고 실제 공개 음원 카드로 교체.
- Explore의 Mock 6곡 및 임의 AI 점수/상태 제거. 실제 AI 검증 요청이나 Blockchain/NFT API 호출 없음.
- GET /api/tracks?scope=public 페이지 목록, 공개 필터, 빈 상태/오류 상태, 실제 audio controls 연결.
- POST /api/v1/auth/signup 201 및 login 200으로 별도 로컬 테스트 계정 인증. 비밀번호는 실행 중 무작위 생성하고 메모리에서만 사용. 기존 사용자 전체 레코드가 작업 전후 동일함을 확인.
- 기존 테스트 음원 ID 1 삭제: 기여자, 검증, 유사도(비교 대상 포함), 라이선스, 거래, 마켓 등록, 메타데이터, 등록 요청, 구매 요청, 초대 모두 0건을 삭제 직전 트랜잭션에서 재확인. 관련 파일도 정리. 사용자 및 스키마 변경 없음.
- Desktop MP3 2개 및 WebM 3개를 POST /api/tracks로 공개 업로드: 5/5 성공(201), MySQL ID 2–6. 원본 SHA-256과 파일 크기 및 탐지 MIME 검증.
- 파일 확장자와 실제 형식 확인: MP3 프레임 구조 검사, WebM EBML 헤더 및 ffprobe Opus/Vorbis 오디오 검사. 선언 MIME과 실제 형식 불일치 거부 로직 및 테스트 추가.
- 각 음원 GET audio 200, byte range 206, 원본 해시 일치. 내려받은 5개 파일 전체를 ffmpeg로 디코딩해 오류 없음 확인.
- 공개 목록 200/5개 반복 조회, 실제 API 연결 Explore 컴포넌트 5개 카드 및 플레이어 렌더, 재마운트 후 유지 검증.
- 브라우저 연결 없이 요청한 작업이므로 UI는 jsdom 컴포넌트 통합 테스트로, 음원 재생은 HTTP 스트리밍과 전체 디코딩으로 검증. 실제 브라우저에서 재생 버튼을 누르고 소리를 청취하는 검증은 수행하지 않음.

## 검증 명령과 결과

- Frontend: npm run build, npm run typecheck 성공.
- Frontend: EXPLORE_LIVE_TEST=1 npm test: 20 통과, 0 실패.
- Backend: npm test (build 포함): 61 통과, 0 실패, 4 건너뜀. 건너뛴 테스트는 별도 MySQL socket/통합 환경 및 실제 블록체인 흐름을 요구하는 기존 조건부 테스트.
- git diff --check: 두 저장소 모두 성공.
- 로컬 Frontend 개발 서버 재시작 후 http://localhost:8443/Frontend/ HTTP 200 확인.
- main 머지/배포 없음. 기존 src/blockchain/sync.ts 변경은 이번 작업 범위 밖이므로 수정하지 않음.

## 변경 파일

Frontend:
- src/features/marketplace/MarketplacePage.tsx
- src/features/marketplace/TrackCard.tsx
- src/features/marketplace/tracks.ts (추가)
- src/features/marketplace/mockTracks.ts (삭제)
- tests/explore.test.ts (추가)
- tests/design-integration.test.ts
- tests/v3-auth-upload.test.ts (기존 비공개 임시저장/confirm 동작에 맞게 테스트 수정)
- docs/index.html 및 docs/assets/* (빌드 산출물)

Backend:
- src/utils/trackFiles.ts
- tests/track.test.cjs
- tests/webm.test.cjs
- docs/explore-real-tracks-verification.md
- docs/explore-real-tracks-verification.json

음원별 ID, MIME, SHA-256, 파일 크기 및 HTTP 결과는 인접 JSON 파일 참조.
