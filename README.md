# Course registration

학생은 회원가입 없이 과목 코드와 명단에 등록된 학생 인증정보로 수강 신청합니다. 관리자 화면은 `/admin`이며 Supabase Auth 계정과 `private.admins` 허용 목록의 UUID가 모두 일치해야 사용할 수 있습니다.

## 설정 및 배포

1. Supabase 프로젝트에 `supabase/migrations/202611240001_initial_schema.sql` 마이그레이션을 적용합니다. 학생 정보, 인증 해시, 수강신청, 요청 기록은 비공개 `private` 스키마에 저장되며 모든 변경은 트랜잭션 RPC로 처리됩니다.
2. Supabase Auth에서 관리자를 생성한 뒤, 해당 계정의 UUID를 확인해 SQL Editor에서 아래 쿼리를 실행합니다.

   ```sql
   insert into private.admins (user_id)
   values ('관리자-auth-uuid');
   ```

3. Vercel 프로젝트의 Production, Preview, Development 환경에 다음 공개 키만 설정합니다.

   ```text
   NEXT_PUBLIC_SUPABASE_URL
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
   ```

4. GitHub `main` 브랜치에 연결된 Vercel 프로젝트에서 자동 배포합니다. Vercel 배포 보호 기능은 학생 공개 접속을 막지 않도록 비활성화해야 합니다.
5. `/admin`에서 제공하는 양식으로 학생 명단 `.xlsx`를 업로드합니다. 업로드 파일은 저장소에서 제외됩니다. 이미 제공된 명단은 배포 시 별도로 가져오지 않으며 운영자가 확인 후 관리자 화면에서 올립니다.

로컬 실행은 `.env.example`을 참고해 `.env.local`을 만들고 `npm run dev`를 실행합니다. Supabase 서비스 역할 키나 비밀 API 키는 애플리케이션에 필요하지 않습니다.

## 검증

- `npm test`: XLSX 명단 검증, 실제 행 번호 오류, 앞자리 0 보존, 한국 시간 변환
- `npm run lint`: ESLint
- `npm run build`: Next.js production build

