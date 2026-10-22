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
    '<script src="data/dali-data.js"></script>\n<script src="mock-claude.js"></script>\n<script src="runtime.js"></script>\n' +
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
    '  auth_error:"API 키가 올바르지 않거나 권한이 없습니다. 배포 설정의 ANTHROPIC_API_KEY를 확인하세요.",\n' +
    '  model_not_found:"설정한 모델 이름을 찾을 수 없습니다. DALI_MODEL_DEFAULT / DALI_MODEL_QUICK를 확인하세요."');
fs.writeFileSync(path.join(__dirname, "..", "index.html"), s);
console.log("wrote index.html (" + Math.round(s.length / 1024) + " KB)");
