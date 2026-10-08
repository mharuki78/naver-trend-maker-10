# 네이버 트렌드 마법사

한이룸의 `트렌드 분석 조건 입력 -> 데이터 취합 -> 세일즈 트렌드 분석` 관리자 콘솔만 분리한 저장소입니다.

이 프로젝트는 LLM API를 사용하지 않습니다. 네이버 쇼핑인사이트 월별 인기검색어를 수집하고, Cloudflare Worker와 D1에서 캐시/분석합니다.

## 배곧 운영 연결

- 웹: `https://baegot-naver-trend.vercel.app/sourcing/admin`
- API: `https://baegot-naver-trend-api.baekhyunjin.workers.dev/v1`
- Cloudflare Worker / D1: `baegot-naver-trend-api` / `baegot-naver-trend-db`
- Google Cloud 프로젝트: `baegot-intranet-auth`, 웹 OAuth 클라이언트 `baegot-naver-trend-web`
- 개인정보 안내: `https://baegot-naver-trend.vercel.app/privacy`

배곧 환경은 `edge-api/wrangler.baegot.jsonc`를 사용합니다. 기존 환경의 Worker·DB·비밀값을 복사하지 않습니다. Google 로그인은 `openid email profile`만 요청하며, `GOOGLE_OAUTH_CLIENT_ID`와 `GOOGLE_OAUTH_CLIENT_SECRET`은 배곧 Worker의 암호화된 비밀값으로 관리합니다. 콜백은 `https://baegot-naver-trend-api.baekhyunjin.workers.dev/v1/auth/google/callback`입니다.

Vercel 프로젝트의 Root Directory는 `web`, Framework는 Next.js, Output Directory는 기본값입니다. Production과 Preview의 `NEXT_PUBLIC_API_BASE_URL`은 위 배곧 API 주소입니다. Google 로그인 완료 주소는 명시적으로 허용한 운영 도메인만 사용할 수 있으므로 Preview에서 Google 로그인을 검수할 때에는 별도의 승인된 주소 설정이 필요합니다.

```bash
npm test
# 인증된 배곧 Cloudflare 계정에서 실행할 때만 실제 배포합니다.
pnpm wrangler deploy --config edge-api/wrangler.baegot.jsonc
```

`npm test`는 Worker를 로컬에서 번들링하고 메모리 SQLite로 인증·리디렉션 검사를 실행합니다. 운영 DB에 접속하거나 배포하지 않습니다. CLI 인증이 없는 경우 Cloudflare의 해당 Worker → Edit code에 `.local/baegot-worker/index.js`를 적용하고 Deploy할 수 있습니다. UI 배포 후 `DB` 바인딩, 암호화된 OAuth 비밀값, 호환 옵션, 2분 Cron 설정을 유지해야 합니다.

인트라넷에서 Google 로그인을 누르면 인증용 창이 잠깐 열립니다. 인증이 끝나면 창이 닫히고 원래 인트라넷 화면에 로그인 상태가 반영되어 그 안에서 분석을 계속합니다. 시작 화면과 연결된 인증 창의 출처를 확인하고, HttpOnly 쿠키로 같은 브라우저의 인증 결과인지 검사합니다. 인증 창은 연결 후 원래 창 참조를 해제하고 Google로 이동합니다. 일회용 연결 키로 서버에서 결과를 받아 오므로 창 간 저장소 공유에 의존하지 않습니다. 연결 키와 인증 쿠키는 15분 후 만료되며 결과는 한 번만 받을 수 있습니다. 대기 중에는 화면의 Google 로그인 취소 버튼으로 중단할 수 있습니다. 인트라넷 계정과 도구 계정은 별개입니다. 새 배곧 DB에는 이전 서비스의 계정과 작업 기록이 자동 이전되지 않습니다. 이메일 가입도 지원하며 Google Sheets 자동 동기화는 별도 서비스 계정 설정이 필요합니다.

## 구성

- `web`: `/sourcing/admin` 화면과 루트 리다이렉트
- `edge-api`: Cloudflare Worker 기반 수집/분석 API
- `shared`: 웹과 Worker가 함께 쓰는 타입/상수

## 현재 서비스 구조

- 공용 웹 1개
- 공용 Cloudflare Worker API 1개
- 공용 D1 데이터베이스 1개
- 사용자 로그인 후 `owner_user_id` 기준으로 데이터 분리

즉, 이제는 `각 사용자가 자기 Worker를 따로 연결하는 구조`가 아니라 `하나의 공용 서비스`로 배포하는 전제를 기준으로 동작합니다.

## 로컬 실행

```bash
pnpm install
pnpm --filter @runacademy/shared build
pnpm --filter @runacademy/web dev
```

선택 사항:

- 로컬에서 Worker까지 같이 확인하려면 `npx wrangler dev --config edge-api/wrangler.jsonc`를 함께 실행합니다.
- 프론트는 개발 환경에서 `NEXT_PUBLIC_API_BASE_URL`이 없으면 배곧 API `https://baegot-naver-trend-api.baekhyunjin.workers.dev/v1`을 바라봅니다.
- 로컬 Worker를 직접 붙이고 싶다면 `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8787/v1`로 따로 지정해 주세요.

관리자 화면:

```text
http://localhost:3000/sourcing/admin
```

## 공용 API / D1 셋업

### 1. Cloudflare 로그인

```bash
pnpm install
pnpm wrangler login
```

### 2. D1 데이터베이스 생성

```bash
pnpm wrangler d1 create naver-trend-maker-db
```

명령 결과에 표시되는 `database_id`를 `edge-api/wrangler.jsonc`의 `REPLACE_WITH_YOUR_D1_DATABASE_ID` 자리에 넣습니다.

### 3. D1 스키마 적용

```bash
pnpm wrangler d1 execute naver-trend-maker-db --remote --file edge-api/schema.sql
```

### 4. Worker 배포

```bash
pnpm wrangler deploy --config edge-api/wrangler.jsonc
```

배포 후 표시되는 Worker URL 뒤에 `/v1`을 붙여 공용 API 주소로 사용합니다.

```text
https://your-shared-api.your-subdomain.workers.dev/v1
```

### 5. 웹 배포 환경변수 설정

웹 배포 환경변수에 공용 API 주소를 설정합니다.

```env
NEXT_PUBLIC_API_BASE_URL=https://your-shared-api.your-subdomain.workers.dev/v1
```

### 6. 로그인 기반 사용자 분리

- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `GET /v1/auth/google/start`
- `GET /v1/auth/google/callback`
- `GET /v1/auth/session`
- `POST /v1/auth/logout`

트렌드 프로필, 수집 런, 스냅샷 조회는 로그인된 사용자 토큰 기준으로만 접근됩니다. 월별 원본 캐시는 같은 조건이면 재사용될 수 있지만, 화면에 보이는 작업 히스토리와 런 상세는 사용자별로 분리됩니다.

### 7. Google 로그인 활성화

Google 로그인까지 쓰려면 Google Cloud Console에서 OAuth 웹 클라이언트를 만든 뒤 Worker secret을 추가해야 합니다.

승인된 리디렉션 URI 예시:

```text
https://your-worker-name.your-subdomain.workers.dev/v1/auth/google/callback
```

Worker secret 설정:

```bash
pnpm wrangler secret put GOOGLE_OAUTH_CLIENT_ID
pnpm wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET
```

선택 환경변수:

```text
AUTH_ALLOWED_RETURN_ORIGINS=https://your-pages-domain.pages.dev,https://*.your-pages-domain.pages.dev,http://localhost:3000,http://127.0.0.1:3000
```

별도 설정이 없더라도 기본적으로 아래 주소는 허용됩니다.

- `http://localhost:3000`
- `http://127.0.0.1:3000`
- `https://hanirum-sourcing-maker-10.pages.dev`
- `https://*.hanirum-sourcing-maker-10.pages.dev`

## 참고 문서

- Cloudflare Wrangler: https://developers.cloudflare.com/workers/wrangler/
- Cloudflare D1 시작하기: https://developers.cloudflare.com/d1/get-started/
- D1 Wrangler 명령어: https://developers.cloudflare.com/d1/wrangler-commands/
- Wrangler 설정: https://developers.cloudflare.com/workers/wrangler/configuration/
