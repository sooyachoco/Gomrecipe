# 곰지연을 위한 레시피 노트 — Cloudflare 버전

모바일 중심의 개인 레시피 노트입니다.

- 일반 주소로 접속: **누구나 열람만 가능**
- 주소 뒤에 `?admin=1`을 붙여 접속 + 관리자 비밀번호 로그인: **작성 / 수정 / 삭제 가능**
- 레시피 데이터: **Cloudflare D1**
- 썸네일 이미지: **Cloudflare R2**
- 화면 + API: **Cloudflare Workers + Static Assets**
- 소스 관리 / 자동 배포: **GitHub**

> 관리자 비밀번호나 Cloudflare API Token은 HTML/JS에 들어가지 않습니다. 반드시 Cloudflare/GitHub의 Secret으로 저장하세요.

## 1. 처음 한 번: 내 컴퓨터에서 Cloudflare 생성

Node.js가 설치되어 있어야 합니다.

```bash
npm install
npx wrangler login
```

먼저 배포합니다. 현재 Wrangler는 `wrangler.jsonc`에 ID가 없는 D1/R2 바인딩을 자동 프로비저닝할 수 있습니다.

```bash
npx wrangler deploy
```

배포 후 `wrangler.jsonc`에 생성된 D1/R2 리소스 ID/이름이 기록되면 **그 변경까지 GitHub에 커밋하는 것을 권장**합니다.

D1 테이블을 생성합니다.

```bash
npm run migrate:remote
```

관리자 비밀번호를 Secret으로 등록합니다.

```bash
npx wrangler secret put ADMIN_PASSWORD
```

세션 서명용 랜덤 Secret도 등록합니다. macOS/Linux에서는 다음처럼 만들 수 있습니다.

```bash
openssl rand -hex 32
npx wrangler secret put SESSION_SECRET
```

`SESSION_SECRET` 입력 질문이 나오면 방금 생성한 값을 붙여넣으세요.

## 2. 접속 방법

배포 완료 후 표시되는 주소가 예를 들어 아래와 같다면:

```text
https://gomjiyeon-recipe-note.<내-subdomain>.workers.dev
```

### 다른 기기 / 가족에게 공유할 주소

```text
https://gomjiyeon-recipe-note.<내-subdomain>.workers.dev
```

이 주소에서는 **레시피 열람만 가능**하며 작성/수정/삭제 버튼이 보이지 않습니다.

### 내가 관리할 주소

```text
https://gomjiyeon-recipe-note.<내-subdomain>.workers.dev/?admin=1
```

상단의 `관리자 로그인`을 눌러 비밀번호를 입력하면 작성 버튼이 나타납니다. 로그인 쿠키는 기본 30일 동안 유지됩니다.

## 3. GitHub에 올리기

새 GitHub repository를 만든 뒤 이 폴더에서:

```bash
git init
git add .
git commit -m "Initial recipe note"
git branch -M main
git remote add origin <내 GitHub 저장소 주소>
git push -u origin main
```

## 4. GitHub Actions 자동 배포

`.github/workflows/deploy.yml`이 포함되어 있습니다. GitHub 저장소의 **Settings → Secrets and variables → Actions**에 다음 두 값을 Repository secrets로 추가하세요.

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

API Token은 Workers 배포와 D1/R2 접근에 필요한 최소 권한만 부여하는 것을 권장합니다.

그 뒤 `main` 브랜치에 push하면 자동으로 Worker를 배포하고 D1 migration을 적용합니다.

## 5. 관리자 비밀번호 바꾸기

```bash
npx wrangler secret put ADMIN_PASSWORD
```

새 비밀번호를 입력하면 됩니다.

기존 로그인 쿠키까지 모두 무효화하려면 `SESSION_SECRET`도 새 값으로 바꾸세요.

```bash
npx wrangler secret put SESSION_SECRET
```

## 6. 로컬에서 테스트

`.dev.vars` 파일을 만들되 Git에는 올리지 마세요.

```text
ADMIN_PASSWORD="테스트용비밀번호"
SESSION_SECRET="충분히길고랜덤한문자열"
```

```bash
npm install
npm run migrate:local
npm run dev
```

브라우저에서 Wrangler가 알려주는 로컬 주소 뒤에 `?admin=1`을 붙이면 관리자 모드를 테스트할 수 있습니다.

## 보안 구조

- `GET /api/recipes`: 공개
- `GET /media/*`: 공개
- 레시피 작성/수정/삭제 및 이미지 업로드: 관리자 세션 필요
- 관리자 세션: `HttpOnly + Secure + SameSite=Strict` 쿠키
- 세션 위변조 방지: Workers Web Crypto HMAC-SHA256
- ADMIN_PASSWORD / SESSION_SECRET: Cloudflare Secret에만 저장

개인용 소규모 레시피 노트를 기준으로 만든 구성입니다.
