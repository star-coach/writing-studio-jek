# 글감 데스크 — AI 협업 블로그 글쓰기 파이프라인

주제 발굴부터 발행까지, 글 한 편의 모든 공정을 9단계로 관리하는 칸반형 웹앱입니다.
모든 AI 호출(주제 추천, 검색, 초고 생성, 다듬기, SEO)은 Netlify Functions를 통해 서버에서만 처리되어,
**Anthropic API 키가 브라우저에 노출되지 않습니다.**

## 9단계 파이프라인

1. **주제 발굴** — 막연한 관심사를 입력하면 AI가 주제 후보 5개를 추천
2. **검색·리서치** — 질문을 입력하면 AI가 웹 검색 후 출처와 함께 정리
3. **사실 검증** — 리서치에서 나온 주장을 항목별로 직접 확인/표시 (AI가 주장 목록 자동 추출도 가능)
4. **나의 노하우** — 본인의 실제 경험/사례/의견 입력 (AI가 절대 대체할 수 없는 핵심 차별점)
5. **AI 초고** — 앞 단계 내용을 모은 프롬프트로 AI가 초고 생성, 생성 기록 보관 및 복원 가능
6. **수정·보강** — 직접 수정 + AI에게 "이런 식으로 다듬어줘" 요청 가능
7. **SEO·구조** — SEO 제목/설명/키워드 및 구조 체크리스트 (AI 자동 생성 가능)
8. **발행 준비** — 최종 점검 체크리스트, 본문 클립보드 복사
9. **발행 완료** — 발행 URL 기록, 발행 후 회고 메모

각 글은 보드 화면에서 카드로 보이며, 현재 단계 컬럼에 위치합니다. 카드를 클릭하면 해당 글의 작업 화면으로 들어가고, 어느 단계로든 자유롭게 이동(뒤로 가기 포함)할 수 있습니다. 모든 단계는 100% 수동 편집이 가능하며, AI 호출은 보조 도구일 뿐입니다.

## 배포 방법 (Netlify)

### 1. GitHub 저장소에 올리기
이 폴더 전체를 GitHub 저장소에 푸시합니다.

```bash
git init
git add .
git commit -m "초기 커밋: 글감 데스크"
git remote add origin <본인의 GitHub 저장소 URL>
git push -u origin main
```

### 2. Netlify에서 사이트 생성
1. https://app.netlify.com 에서 "Add new site" → "Import an existing project"
2. GitHub 저장소 선택
3. Build settings는 `netlify.toml`에 이미 정의되어 있어 별도 설정 없이 그대로 배포(Deploy) 진행

### 3. API 키 환경변수 설정 (가장 중요)
Netlify 대시보드 → 해당 사이트 → **Site configuration → Environment variables** → "Add a variable"

| Key | Value |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com에서 발급받은 API 키 |

저장 후 **반드시 재배포(Trigger deploy)** 해야 환경변수가 함수에 적용됩니다.

### 4. API 키 발급 방법
1. https://console.anthropic.com 가입/로그인
2. API Keys 메뉴에서 새 키 생성
3. 결제 정보 등록 후 사용량만큼 과금됨 (선불 크레딧 또는 카드 등록)

## Firebase 동기화 (선택, 권장)

기본 상태로는 데이터가 **이 브라우저의 로컬 저장소(localStorage)에만** 저장됩니다.
다른 기기에서도 같은 데이터를 보고 싶다면 Firebase Realtime Database를 연결하세요.

1. 기존에 만들어두신 Firebase 프로젝트(부공위 통합앱 등에서 쓰신 것과 같거나 새 프로젝트)의 콘솔로 이동
2. 프로젝트 설정 → 일반 → "내 앱" → 웹 앱 추가 (이미 있다면 기존 설정 사용)
3. 아래와 같은 형태의 설정 객체를 복사

```json
{
  "apiKey": "...",
  "authDomain": "....firebaseapp.com",
  "databaseURL": "https://....firebaseio.com",
  "projectId": "...",
  "storageBucket": "....appspot.com",
  "messagingSenderId": "...",
  "appId": "..."
}
```

4. 앱 우측 상단 "설정" 버튼 클릭 → Firebase 설정 칸에 붙여넣기 → "Firebase 설정 저장 및 연결" 클릭
5. 연결되면 이후 모든 글 데이터가 실시간으로 Firebase에도 저장되어, 같은 설정을 입력한 다른 기기/브라우저에서도 동일한 글 목록을 보고 편집할 수 있습니다.

**주의**: 이 앱은 별도 로그인 기능이 없습니다. Firebase Realtime Database 보안 규칙을 본인만 접근 가능하도록 설정하거나(예: 특정 IP 제한, 또는 Firebase Auth 추가), 데이터베이스 URL/키 자체를 외부에 공유하지 않는 방식으로 보호하는 것을 권장합니다. 부공위 통합앱에서 쓰신 Firebase 프로젝트의 보안 규칙을 참고하시면 됩니다.

## 로컬에서 테스트하기 (배포 전 미리보기)

Netlify CLI를 설치하면 로컬에서 Functions까지 포함해 테스트할 수 있습니다.

```bash
npm install -g netlify-cli
cd blog-pipeline
netlify dev
```

`.env` 파일을 만들어 로컬 테스트용 키를 넣을 수도 있습니다 (이 파일은 절대 GitHub에 올리지 마세요):

```
ANTHROPIC_API_KEY=sk-ant-...
```

## 데이터 백업

설정 모달에서 "전체 데이터 내보내기"를 누르면 모든 글 데이터가 JSON 파일로 다운로드됩니다.
주기적으로 백업해두시고, 필요시 "데이터 가져오기"로 복원할 수 있습니다.

## 폴더 구조

```
blog-pipeline/
├── netlify.toml              # Netlify 빌드/리다이렉트 설정
├── package.json
├── public/
│   ├── index.html            # 메인 화면 구조
│   ├── style.css             # 디자인 (편집 데스크 컨셉)
│   └── app.js                # 전체 앱 로직 (상태관리, 렌더링, API 호출)
└── netlify/
    └── functions/
        ├── claude.js         # 일반 텍스트 생성용 API 프록시
        └── search.js         # 웹 검색 포함 생성용 API 프록시
```
