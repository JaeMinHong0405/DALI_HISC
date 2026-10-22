/**
 * Build index.html (web / serverless version) from the claude.ai version of the DALI page.
 *   node scripts/build-page.js scripts/claude-ai-index.html
 */
"use strict";
const fs = require("fs");
const path = require("path");
const src = process.argv[2];
if (!src) { console.error("usage: node scripts/build-page.js <claude-ai index.html>"); process.exit(1); }
let s = fs.readFileSync(src, "utf8");
function rep(from, to) {
  if (!s.includes(from)) { console.error("build-page: pattern not found:\n  " + from.slice(0, 120)); process.exit(1); }
  s = s.replace(from, to);
}
// web runtime + data load before the app boots
rep('<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>',
    '<script src="data/dali-data.js"></script>\n<script src="mock-claude.js"></script>\n<script src="runtime.js"></script>\n<script src="law-api.js"></script>\n' +
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>');
s = s.replace(/<meta name="claude:[^>]*>\n?/g, "");
// status pill knows about demo mode
rep('claude.use("sample").then(s => { S.sample = s; setPill($("#pillApi"), s?"on":"off", s?"Claude API 연결":"Claude API 사용 불가"); });',
    'claude.use("sample").then(s => { S.sample = s; setPill($("#pillApi"), !s?"off": s.demo?"wait":"on", !s?"Claude API 사용 불가": s.demo?"데모 모드":"Claude API 연결"); });');
// extra error messages for the serverless function
rep('upstream_error:"API 연결이 잠시 끊겼습니다. 다시 실행해 주세요."',
    'upstream_error:"API 연결이 잠시 끊겼습니다. 다시 실행해 주세요.",\n' +
    '  bad_access_code:"접속 코드가 맞지 않습니다. 다시 입력하세요.",\n' +
    '  no_api_key:"서버리스 함수에 API 키가 설정되지 않았습니다. 배포 설정의 환경 변수를 확인하세요.",\n' +
    '  auth_error:"API 키가 올바르지 않거나 권한이 없습니다. 오른쪽 위 \'AI 설정\'(Gemini) 또는 배포 환경 변수(Claude)를 확인하세요.",\n' +
    '  model_not_found:"모델 이름을 찾을 수 없습니다. 오른쪽 위 \'AI 설정\'에서 모델을 다시 고르세요."');
// provider-neutral labels (the web version can use Claude, Gemini or demo mode)
for (const [from, to] of [
  ["Claude가 그 조문만 인용해", "AI가 그 조문만 인용해"],
  ["① 검색어 확장 · Claude", "① 검색어 확장 · AI"],
  ["③ 근거 답변 · Claude", "③ 근거 답변 · AI"],
  ["② 초안 작성 · Claude", "② 초안 작성 · AI"],
  ["Claude API 요청·응답 실시간 로그", "AI API 요청·응답 실시간 로그"],
  ["<span>Claude API 확인 중</span>", "<span>AI 연결 확인 중</span>"],
]) rep(from, to);
fs.writeFileSync(path.join(__dirname, "..", "index.html"), s);
console.log("wrote index.html (" + Math.round(s.length / 1024) + " KB)");
