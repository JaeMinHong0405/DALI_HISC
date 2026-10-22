# DALI — 디지털 자산 규제 Q&A (서버리스 웹 버전)

미래전략실 DALI PoC를 **서버 없이** 실행하는 웹 버전입니다.
GitHub Pages · Vercel 같은 정적 호스팅에 올리거나, `index.html`을 더블클릭해 바로 열 수 있습니다.

| 모드 | 언제 | 질문·답변 / 챗봇 / 문서 작업 | 검색 · 근거 원문 · 문서 관리 |
|---|---|---|---|
| **데모 모드** (기본) | API 키 없이 어디서나 | 근거 조문 문장을 **발췌한 모의 응답** | 실제 데이터 (문서 121건 · 조문 3,284건) |
| **Gemini 모드** | 사용자가 화면의 **AI 설정**에 자기 Gemini API 키(무료 발급) 입력 — GitHub Pages에서도 동작 | 실제 Gemini 응답 (실시간 스트리밍) | 실제 데이터 |
| **Claude 모드** | Vercel에 배포하고 API 키 + 접속 코드 설정 | 실제 Claude 응답 (실시간 스트리밍) | 실제 데이터 |

- 데모 모드는 내용을 지어내지 않습니다. 검색된 조문의 문장을 그대로 인용하고(근거 표시 포함), 해석·판단은 〔확인 필요〕로 비워 둡니다. 화면 상단 배너와 상태 표시에 **데모 모드**라고 나옵니다.
- 오른쪽 **API 콘솔**에는 데모 모드에서도 요청(input)과 응답(output)이 실시간으로 표시됩니다. 모델 표시는 `demo (모의 응답)`입니다.

---

## Gemini 무료 키로 실제 AI 응답 보기 (서버 불필요)

1. https://aistudio.google.com/apikey 에 Google 계정으로 로그인 → **Create API key** → 키 복사
2. DALI 화면 오른쪽 위 **AI 설정** → **Gemini** 선택 → 키 붙여넣기 → **연결 테스트** (사용 가능한 모델 목록이 자동으로 채워짐, 기본 `gemini-3.8-flash`) → **저장**
3. 상태 표시가 **Gemini 연결**로 바뀌면 질문·답변, 챗봇, 문서 작업이 실제 AI로 동작합니다.

- 키는 **각 사용자의 브라우저에만** 저장되고 Google로만 전송됩니다. 저장소·코드·다른 사용자에게는 전달되지 않으므로, **키를 저장소나 채팅에 올리지 마세요.**
- 무료 등급은 사용량 제한이 있고, 입력 내용이 Google 제품 개선에 쓰일 수 있습니다. **사내 기밀·거래 정보는 입력하지 말고**, 공개 법령 기반 검토·시연 용도로 쓰세요.
- 공용 PC에서는 사용 후 **AI 설정 → 키 삭제**.
- 모델 이름이 바뀌면 AI 설정에서 **연결 테스트**를 다시 눌러 목록을 새로 불러오면 됩니다.

## 국가법령정보 Open API로 현행 법령 가져오기

**문서 관리 → 국가법령정보 API에서 가져오기**에서 법령(법률·시행령·시행규칙)이나 행정규칙(고시·훈령)을 검색하고 **가져오기**를 누르면, 법제처 국가법령정보센터의 **현행본** 전체 조문을 받아 조 단위로 등록합니다. 등록 즉시 질문·답변, 챗봇, 규정 비교, 문서 작업의 근거로 쓰입니다.

- 인증키(OC)는 공개 저장소 공용 값 `LAW0223`이 기본으로 들어 있습니다(누구나 호출 가능). 바꾸려면 패널의 **연결 설정**에서 수정하거나, Vercel 환경 변수 `LAW_OC`를 설정합니다.
- '같은 이름의 내장 수집본 빼기'를 켜 두면 2025년 8월 수집본 대신 방금 받은 현행본만 검색됩니다(되돌리기: 콘솔에서 `daliResetLocalData()`).
- 별표·서식·부칙은 가져오지 않습니다. 가져온 문서는 그 브라우저에만 저장됩니다.

**호출 경로** (위에서부터 자동 시도)

| 순서 | 경로 | 언제 쓰이나 |
|---|---|---|
| 1 | 같은 사이트의 `api/law` | Vercel 배포 또는 `node scripts/dev-server.js` 실행 시 |
| 2 | 연결 설정의 **중계 주소** | GitHub Pages에서 직접 호출이 막힐 때 |
| 3 | `https://www.law.go.kr/DRF` 직접 호출 | 브라우저 CORS가 허용될 때만 |

국가법령정보센터는 브라우저의 직접 호출(CORS)을 허용하지 않을 수 있습니다. GitHub Pages에서 "CORS" 안내가 나오면 중계 주소를 하나 만드세요(둘 중 하나, 모두 무료).
- **Cloudflare Worker**: dash.cloudflare.com → Workers & Pages → Create → Worker → `relay/law-relay-worker.js` 내용 붙여넣기 → Deploy → 나온 `https://….workers.dev` 주소를 연결 설정의 중계 주소에 입력
- **Vercel**: 이 폴더를 Vercel에 배포(저장소 루트가 상위 폴더면 Project Settings → Root Directory를 `dali-web`으로) → `https://<프로젝트>.vercel.app/api/law` 를 중계 주소에 입력. Vercel에서 바로 열면 1번 경로로 자동 연결됩니다.

open.law.go.kr의 API 신청 정보에 **도메인/IP 등록**이 필요한 경우, 실제로 호출하는 곳(중계 Worker·Vercel 주소 또는 GitHub Pages 주소)을 등록해야 "사용자 정보 검증에 실패" 오류가 나지 않습니다.

## 1. 바로 열어 보기

`index.html`을 더블클릭 → 브라우저에서 데모 모드로 열립니다. (인터넷 연결 시 글꼴·PDF 모듈을 CDN에서 불러옵니다)

## 2. GitHub에 올리기

**웹에서 (가장 쉬움)**
1. github.com → **New repository** → 이름 `dali-web` → **Private 권장** (아래 '데이터 출처' 참고) → Create
2. **uploading an existing file** → 이 폴더의 파일·폴더를 모두 끌어다 놓기 → **Commit changes**

**Git으로**
```bash
git init && git add -A && git commit -m "DALI web"
git branch -M main
git remote add origin https://github.com/<계정>/dali-web.git
git push -u origin main
```

## 3-A. GitHub Pages로 공개 (데모 모드만)

저장소 **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)` → Save**
1~2분 뒤 `https://<계정>.github.io/dali-web/` 에서 열립니다.
- GitHub Pages에는 서버 기능이 없어 기본은 **데모 모드**이고, 사용자가 **AI 설정**에 Gemini 키를 넣으면 실제 AI 응답으로 바뀝니다. (Claude 모드는 Vercel 배포가 필요)
- 비공개(Private) 저장소의 Pages는 GitHub 유료 플랜이 필요합니다. 공개 저장소로 올리면 데이터도 공개되니 '데이터 출처'를 먼저 확인하세요.

## 3-B. Vercel로 배포 (서버리스 · 실제 Claude 사용 가능 · 비공개 저장소 무료)

1. https://vercel.com → GitHub로 로그인 → **Add New → Project** → `dali-web` 저장소 **Import**
2. Framework Preset: **Other** (빌드 설정은 비워 둠) → **Deploy**
   → 이 상태로 데모 모드 사이트가 열립니다.
3. 실제 Claude를 켜려면 **Settings → Environment Variables**에 추가 후 **Deployments → Redeploy**

| 이름 | 값 |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API 키 (console.anthropic.com) |
| `DALI_ACCESS_CODE` | 팀에만 알려 줄 접속 코드 (예: 임의의 긴 문자열) |
| `DALI_MODEL_DEFAULT` | (선택) 기본 `claude-sonnet-5-5` |
| `DALI_MODEL_QUICK` | (선택) 기본 `claude-haiku-5-5` |
| `LAW_OC` | (선택) 국가법령정보 API 인증키, 기본 `LAW0223` |

- **API 키와 접속 코드를 둘 다 설정해야만** Claude 모드가 켜집니다. 주소를 아는 외부인이 회사 API 키를 쓰지 못하게 하려는 장치입니다.
- 사용자는 처음 질문할 때 접속 코드를 한 번 입력합니다(브라우저에 기억).
- API 키는 Vercel 서버리스 함수(`api/claude.js`) 안에서만 쓰이고 브라우저로 전달되지 않습니다.
- 비용: Anthropic API 사용량만큼 과금됩니다(Vercel Hobby 플랜은 무료, 함수 실행 시간 제한 60초).

## 4. 내 PC에서 배포 환경 그대로 미리보기 (선택)

Node.js 18 이상:
```bash
node scripts/dev-server.js                     # 데모 모드 → http://localhost:3000
```
Claude 모드로 미리보기 (macOS/Linux):
```bash
ANTHROPIC_API_KEY=sk-ant-... DALI_ACCESS_CODE=내코드 node scripts/dev-server.js
```
Windows PowerShell:
```powershell
$env:ANTHROPIC_API_KEY="sk-ant-..."; $env:DALI_ACCESS_CODE="내코드"; node scripts/dev-server.js
```

---

## 폴더 구조

```
dali-web/
├─ index.html            DALI 화면 (claude.ai 버전과 동일한 기능)
├─ runtime.js            서버 없이 동작하게 하는 연결부: 내장 데이터 · 브라우저 저장 · 데모/Gemini/Claude 전환 · AI 설정 창
├─ mock-claude.js        데모 모드 응답 엔진 (조문 문장 발췌 기반, API 불필요)
├─ law-api.js            국가법령정보 Open API 연동 (문서 관리 화면의 '가져오기' 패널)
├─ data/dali-data.js     내장 데이터 (문서 121건 · 조문 3,284건)
├─ api/                  Vercel 서버리스 함수 (Claude 모드에서만 사용)
│  ├─ claude.js          Claude 호출 (스트리밍) — 접속 코드 확인
│  ├─ law.js             국가법령정보 API 중계 (OC 기본 LAW0223, 환경 변수 LAW_OC)
│  ├─ health.js          모드 확인
│  └─ _shared.js         공통 설정
├─ relay/law-relay-worker.js  국가법령정보 API 중계 (Cloudflare Worker용, GitHub Pages에서 사용)
├─ vercel.json           함수 실행 시간 설정
├─ scripts/
│  ├─ dev-server.js      로컬 미리보기 서버
│  ├─ build-page.js      claude.ai 버전 화면 → 웹 버전으로 변환
│  └─ claude-ai-index.html  변환 원본
└─ package.json
```

## 알아 두기

- **문서 관리에서 추가한 문서**는 그 브라우저에만 저장됩니다(다른 사람·다른 PC에는 보이지 않음). 초기화: 브라우저 개발자 도구 콘솔에서 `daliResetLocalData()` 실행.
- **데모 모드 검색 팁**: 해외 규정을 물을 때는 질문에 관할(ADGM, VARA, EU, MiCA, 미국 등)을 넣거나, 문서 작업에서 **근거 범위(국가)**를 지정하면 해당 국가 조문이 우선 인용됩니다.
- **claude.ai 버전을 고친 뒤 반영**: 새 `index.html`을 `scripts/claude-ai-index.html`에 덮어쓰고 `node scripts/build-page.js scripts/claude-ai-index.html` 실행.
- 데모·Claude 응답 모두 **초안**입니다. 결재·발송·서명 전 담당자와 법무 검토가 필요합니다.

## 데이터 출처 (공개 범위를 정하기 전에 확인)

| 데이터 | 출처 | 비고 |
|---|---|---|
| 미국 연방 규정·가이드라인 | Hugging Face `vaquill/open-us-law` | 법령 본문 퍼블릭 도메인, 편집본 **CC BY-NC 4.0 (비상업적 이용)** |
| 한국 법령·행정규칙 | Hugging Face `mosshoon/korean-laws`, `mosshoon/korean-admin-rules` | 2025년 8월 기준 수집본, 일부 목(가·나·다) 누락 — 국가법령정보센터 원문과 대조 필요 |
| UAE 연방법 | Hugging Face `obadabaq/structured-uae-laws` | 데이터셋 페이지의 라이선스 확인 |
| EU 금융 규정 | Hugging Face `chenjigaram/eu-financial-regulation-aligned` | 데이터셋 페이지의 라이선스 확인 |
| Dubai VARA Rulebooks · ADGM FSRA Rulebook | 각 감독기관 웹사이트 인쇄본(PDF) | 감독기관 게시물 — 외부 공개 전 이용 조건 확인 |

문서별 출처·라이선스·상태는 앱의 **문서 관리** 화면에서 볼 수 있습니다.
비상업적 이용 조건과 감독기관 게시물이 포함되어 있으므로 **비공개(Private) 저장소 + Vercel** 조합을 권장합니다.
