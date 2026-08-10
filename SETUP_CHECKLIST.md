# 빠른 설치 체크리스트

- [ ] `npm install`
- [ ] `npx wrangler login`
- [ ] `npx wrangler deploy`
- [ ] `npm run migrate:remote`
- [ ] `npx wrangler secret put ADMIN_PASSWORD`
- [ ] `openssl rand -hex 32` 로 랜덤 값 생성
- [ ] `npx wrangler secret put SESSION_SECRET`
- [ ] 일반 주소에서 작성 버튼이 안 보이는지 확인
- [ ] `?admin=1` 주소에서 로그인 후 작성되는지 확인
- [ ] 첫 배포로 `wrangler.jsonc`에 기록된 D1/R2 ID가 있다면 commit
- [ ] GitHub repository 생성 후 push
- [ ] GitHub Actions secrets에 `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` 등록
