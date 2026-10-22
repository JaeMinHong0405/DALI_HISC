/**
 * DALI demo mode — answers without the Claude API.
 *
 * It never invents content: every answer is built from sentences quoted from the
 * articles the app retrieved, with their real citation IDs ([A1], [S2] …).
 * Interpretation, judgement and company-specific facts are left as 〔확인 필요〕 blanks.
 * When the Claude API is connected (see README), this file is not used.
 */
(function () {
  "use strict";

  /* ---------- terms ---------- */
  const GLOSSARY = [
    [["가상자산", "암호자산", "디지털자산", "디지털 자산"], ["virtual asset", "crypto-asset", "crypto asset", "digital asset"]],
    [["예치금", "예치"], ["client money", "deposit", "funds"]],
    [["수탁", "보관", "커스터디"], ["custody", "safekeeping", "custodian"]],
    [["고객자산", "고객 자산", "이용자 자산"], ["client assets", "client crypto-assets"]],
    [["분리"], ["segregation", "segregate"]],
    [["스테이블코인", "법정화폐 연동"], ["stablecoin", "fiat-referenced token", "payment stablecoin", "e-money token"]],
    [["준비자산", "준비금"], ["reserve assets", "reserve"]],
    [["공시", "공개"], ["disclosure", "disclose"]],
    [["미공개중요정보", "내부자", "내부 정보"], ["inside information", "insider dealing", "insider"]],
    [["불공정거래", "시세조종"], ["market abuse", "manipulation"]],
    [["토큰증권", "증권형 토큰"], ["security token", "digital securities", "tokenised"]],
    [["증권"], ["securities", "security"]],
    [["인가", "허가", "라이선스", "등록"], ["authorisation", "authorization", "licence", "license", "registration"]],
    [["자본", "자기자본"], ["capital", "own funds"]],
    [["자금세탁", "자금 세탁"], ["money laundering", "anti-money laundering", "aml"]],
    [["발행", "발행인"], ["issuance", "issuer", "issue"]],
    [["거래소", "거래플랫폼"], ["exchange", "trading platform"]],
    [["중개", "브로커"], ["broker", "broker-dealer"]],
    [["과세", "세금", "보고"], ["tax", "reporting", "broker reporting"]],
    [["은행"], ["bank", "banking"]],
    [["비밀유지", "기밀"], ["confidentiality", "confidential information", "professional secrecy"]],
    [["계약"], ["agreement", "contract"]],
    [["adgm", "아부다비"], ["adgm", "fsra", "fsmr", "cobs", "virtual asset"]],
    [["vara", "두바이"], ["vara", "vasp", "virtual asset service provider"]],
    [["이용자 보호", "투자자 보호"], ["investor protection", "client protection"]],
  ];
  const PARTICLE = /(으로|에서|에게|까지|부터|이나|이며|이고|하는|하고|한다|해야|하면|에는|과의|와의|으로서|로서|은|는|이|가|을|를|의|에|와|과|도|만|로)$/;
  const STOP = new Set(["관련", "대해", "대한", "어떻게", "무엇", "있는", "있나요", "인가요", "알려줘", "정리", "해줘", "사내", "문서", "초안", "쓰기", "위해", "등록", "법령", "조문", "근거", "원문", "찾으려", "찾는다", "한국어", "영어", "작성", "요청", "제시해", "현재", "법률", "규정", "회사", "체결을", "하려고", "하는데", "the", "and", "for", "with", "what", "how", "are", "is", "of", "to", "in", "on", "a", "an"]);

  function terms(q) {
    const out = new Set();
    for (const raw of String(q || "").toLowerCase().split(/[^0-9a-z가-힣]+/)) {
      if (!raw || STOP.has(raw)) continue;
      let w = raw;
      if (/[가-힣]/.test(w) && w.length > 2) w = w.replace(PARTICLE, "");
      if (w.length >= 2 && !STOP.has(w)) out.add(w);
    }
    return [...out];
  }
  function expand(q) {
    const t = terms(q), low = String(q || "").toLowerCase();
    const ko = new Set(), en = new Set();
    // regulatory glossary terms first, then the user's own words
    for (const [k, e] of GLOSSARY) {
      if (k.some(w => low.includes(w)) || e.some(w => low.includes(w))) { k.forEach(w => ko.add(w)); e.forEach(w => en.add(w)); }
    }
    t.filter(x => /[가-힣]/.test(x)).forEach(x => ko.add(x));
    t.filter(x => /[a-z]/.test(x) && x.length > 2).forEach(x => en.add(x));
    return { ko: [...ko].slice(0, 12), en: [...en].slice(0, 12) };
  }

  const foreign = q => /adgm|vara|아부다비|두바이|uae|\beu\b|mica|유럽|미국|\bus\b|genius|sec\b/i.test(q || "") && !/한국|국내/.test(q || "");

  /* ---------- reading the prompt the app built ---------- */
  function between(s, start, endRe) {
    const i = s.indexOf(start); if (i < 0) return "";
    const rest = s.slice(i + start.length);
    const m = endRe ? rest.search(endRe) : -1;
    return (m >= 0 ? rest.slice(0, m) : rest).trim();
  }
  const COUNTRIES = /^(미국|한국|EU|UAE|영국|일본|싱가포르|홍콩|기타)$/;
  function articles(input) {
    const re = /^\[(A|S)(\d+)\] (.*)$/gm, heads = [];
    let m;
    while ((m = re.exec(input))) heads.push({ kind: m[1], n: +m[2], head: m[3], start: m.index, bodyStart: m.index + m[0].length });
    return heads.map((h, i) => {
      const end = i + 1 < heads.length ? heads[i + 1].start : input.length;
      let body = input.slice(h.bodyStart, end);
      const cut = body.search(/\n#{2,3} |\n\n\[[^\]AS]/); if (cut >= 0) body = body.slice(0, cut);
      const f = h.head.split(" | ").map(x => x.trim());
      const fields = f.filter(x => !/^문서 상태:/.test(x));
      const country = fields.find(x => COUNTRIES.test(x)) || "";
      const label = fields[fields.length - 1] || "";
      return { id: h.kind + h.n, kind: h.kind, n: h.n, title: fields[0] || "", country, label, dead: /철회|폐지/.test(h.head), text: body.trim() };
    });
  }
  function sentences(text) {
    return String(text).split(/\n+|(?<=다\.)\s+|(?<=[.;:])\s+(?=[A-Z(“"])/)
      .map(s => s.replace(/\s+/g, " ").trim()).filter(s => s.length >= 15);
  }
  function clip(s, n = 200) { return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; }
  function score(s, ts) { const low = s.toLowerCase(); let k = 0; for (const t of ts) if (low.includes(t)) k += t.length > 3 ? 2 : 1; return k; }
  function best(a, ts, skip) {
    let top = null, sc = -1;
    for (const s of sentences(a.text)) { if (skip && skip.has(s)) continue; const v = score(s, ts); if (v > sc) { sc = v; top = s; } }
    return { s: top ? clip(top) : clip(a.text.replace(/\s+/g, " ")), score: Math.max(0, sc) };
  }
  const JURIS = [
    [/adgm|아부다비|fsra/i, a => /ADGM|FSRA/.test(a.title + a.label)],
    [/vara|두바이|dubai/i, a => /VARA/.test(a.title + a.label)],
    [/uae|아랍에미리트/i, a => a.country === "UAE"],
    [/\beu\b|mica|유럽/i, a => a.country === "EU"],
    [/미국|\bus\b|sec\b|genius|occ|cftc/i, a => a.country === "미국"],
    [/한국|국내|우리나라/i, a => a.country === "한국"],
  ];
  function ranked(arts, ts, q) {
    const want = JURIS.filter(([re]) => re.test(q || "")).map(([, f]) => f);
    return arts.map(a => { const b = best(a, ts); const hit = want.length && want.some(f => f(a)); return { a, ...b, score: b.score + (b.score > 0 && hit ? 6 : 0) - (want.length && !hit ? 1 : 0) }; })
      .sort((x, y) => y.score - x.score);
  }
  const cite = a => `[${a.id}]`;
  const tag = a => (a.dead ? " (철회·폐지 문서)" : "");

  /* ---------- 1) Q&A answer ---------- */
  function qaAnswer(input) {
    const q = between(input, "질문: ", /\n\n\[근거 조문\]/);
    const ts = [...terms(q), ...expand(q).ko, ...expand(q).en];
    const r = ranked(articles(input), ts, q);
    if (!r.length || r[0].score <= 0) return `근거 없음\n데모 모드에서 질문과 겹치는 조문 문장을 찾지 못했습니다. 다른 표현으로 물어보거나 AI 설정에서 Gemini를 연결한 뒤 다시 확인하세요.`;
    const top = r.filter(x => x.score > 0);
    return [
      "## 요약",
      "- ⚠ 지금은 **데모 모드**라 AI 해설 없이 관련 조문 문장만 발췌해 보여 드립니다. 해설·정리된 답변은 오른쪽 위 **AI 설정**에서 Gemini 키를 넣으면 나옵니다.",
      ...top.slice(0, 3).map(x => `- ${x.a.label}${tag(x.a)}: "${x.s}" ${cite(x.a)}`),
      "## 세부 내용",
      ...top.slice(0, 6).map(x => `- **${x.a.title}** ${x.a.label} — "${best(x.a, ts, new Set([x.s.replace(/…$/, "")])).s}" ${cite(x.a)}`),
      "## 확인 필요",
      "- 데모 모드 응답은 AI 해석이 아닌 원문 발췌이므로, 해석과 적용 여부는 AI(Gemini) 연결 후 확인 필요",
    ].join("\n");
  }

  /* ---------- 2) chatbot answer ---------- */
  function chatAnswer(input) {
    const q = between(input, "[이번 질문]\n", /\n\(독립 질문으로 풀면|\n\n\[근거 조문\]/);
    const ts = [...terms(q), ...expand(q).ko, ...expand(q).en];
    const r = ranked(articles(input), ts, q).filter(x => x.score > 0);
    if (!r.length) return `근거 없음\n데모 모드에서 이 질문과 겹치는 조문을 찾지 못했습니다.\n\n## 이어서 물어볼 만한 질문\n- 다른 국가 규정에서는 어떻게 정하고 있어?`;
    const lines = [`데모 모드에서는 관련 조문의 문장을 그대로 보여 드립니다.`, ""];
    for (const x of r.slice(0, 3)) lines.push(`- **${x.a.label}**${tag(x.a)}: "${x.s}" ${cite(x.a)}`);
    lines.push("", "## 이어서 물어볼 만한 질문");
    for (const x of r.slice(0, 2)) lines.push(`- ${x.a.label}의 세부 요건을 더 알려줘`);
    lines.push("- 다른 국가 규정과 비교하면?");
    return lines.join("\n");
  }

  /* ---------- 3) country comparison (JSON) ---------- */
  function compareJson(input) {
    const issue = (input.match(/쟁점 "([^"]+)"/) || [])[1] || "";
    const ts = [...terms(issue), ...expand(issue).ko, ...expand(issue).en];
    const sections = input.split(/^### /m).slice(1);
    const rows = [];
    for (const sec of sections) {
      const country = sec.split("\n")[0].trim();
      const r = ranked(articles(sec), ts, issue).filter(x => x.score > 0);
      if (!r.length) rows.push({ country, status: "해당 규정 없음", summary: "검색된 조문에서 이 쟁점과 겹치는 문장을 찾지 못했습니다.", cites: [] });
      else rows.push({ country, status: "규정 있음", summary: `(원문 발췌) ${r[0].a.label}: "${clip(r[0].s, 160)}"`, cites: r.slice(0, 2).map(x => x.a.id) });
    }
    return { rows, diff: ["데모 모드: 국가별 핵심 조문 문장을 발췌해 나란히 보여 줍니다. 차이 분석은 AI 설정에서 Gemini를 연결하면 제공됩니다."] };
  }

  /* ---------- 4) document drafts ---------- */
  function topicOf(prompt) {
    let t = String(prompt).split(/[.\n]/)[0].trim();
    const lead = t.replace(/^.*?(에 따라|에 따른|관련하여|과 관련해|와 관련해|을 위해|를 위해)\s+/, "");
    if (lead.length >= 6) t = lead;
    t = t.replace(/^(이번|당사의?|우리|현재)\s+/, "");
    t = t.split(/\s*(?:가능성|여부)?(?:을|를)?\s*(?:검토|정리|보고|작성|비교|점검|체결|제시)|(?:을|를)\s+\S+(?:께|에게)\s/)[0];
    t = t.split(/하려고|하는데|써 ?줘|해 ?줘/)[0].replace(/(을|를|의|에|으로|로)\s*$/, "").trim();
    if (t.length > 40) { const cut = t.lastIndexOf(" ", 40); t = t.slice(0, cut > 12 ? cut : 40); }
    t = t.replace(/(을|를|의|에|으로|로|은|는|이|가)\s*$/, "").trim();
    return t.length >= 4 ? t : "규제 검토";
  }
  function feed(r) { let i = 0; return () => (r.length ? r[i++ % r.length] : null); }
  function factBullets(next, k, ts, used, prefix = "") {
    const out = [];
    for (let j = 0; j < k; j++) {
      const x = next(); if (!x) break;
      const b = best(x.a, ts, used); used.add(b.s.replace(/…$/, ""));
      out.push(`- ${prefix}${x.a.label}${tag(x.a)}: "${b.s}" ${cite(x.a)}`);
    }
    return out.length ? out : ["- 근거 없음 — 추가로 필요한 원문: 〔확인 필요〕"];
  }
  function draftDoc(input) {
    const typeName = (input.match(/\[작성할 문서\] ([^(\n]+)/) || [])[1]?.trim() || "검토 보고서";
    const prompt = between(input, "[작성 맥락·요청]\n", /\n\[(보고 대상·수신|계약 상대방)\]/);
    const to = (input.match(/\[(?:보고 대상·수신|계약 상대방)\] (.*)/) || [])[1] || "";
    const frame = between(input, "[문서 구성]\n", /\n\n\[근거 조문\]/);
    const ts = [...terms(prompt), ...expand(prompt).ko, ...expand(prompt).en];
    const arts = articles(input), r = ranked(arts, ts, prompt), next = feed(r), used = new Set();
    const topic = topicOf(prompt), toName = to && to !== "(지정 안 함)" ? to : "";
    if (/계약서/.test(typeName)) return contractDoc(input, r, ts, topic, toName);

    const out = [];
    const title = {
      "기안문": `${topic} 관련 검토 추진(안)`, "검토 보고서": `${topic} 검토 보고`, "임원 보고": `${topic} 보고`,
      "규정 비교 메모": `${topic} 비교 — ${[...new Set(arts.map(a => a.country).filter(Boolean))].slice(0, 3).join("·") || "국가별"}`,
      "업무 메일": `[미래전략실] ${topic} 검토 내용 공유`,
    }[typeName] || `${topic} 검토`;
    out.push(`# ${title}`);

    if (typeName === "업무 메일") {
      out.push(`${toName ? toName + "님" : "〔확인 필요: 수신자〕님"}, 안녕하세요. 미래전략실입니다.`);
      out.push(`${topic} 관련하여 확인한 규정 내용을 공유드립니다.`);
      out.push("## 주요 내용", ...factBullets(next, 3, ts, used));
      out.push("## 요청 사항", "- 〔확인 필요: 회신 기한〕까지 검토 의견 부탁드립니다.");
      out.push("검토 부탁드립니다. 감사합니다.");
      return out.join("\n");
    }
    if (typeName === "임원 보고") out.push(`> ${topic}: 관련 근거 조문 ${r.filter(x => x.score > 0).length || r.length}건 확인 — 세부 판단과 건의는 〔확인 필요: 담당 부서 검토〕`);

    const heads = frame.split("\n").filter(l => /^##+ /.test(l)).map(l => l.replace(/\s*←.*$/, ""));
    for (const h of heads) {
      const name = h.replace(/^##+ /, "");
      if (/^#{3} /.test(h)) continue;
      if (/붙임/.test(name)) continue;
      out.push(h.startsWith("### ") ? h : `## ${name}`);
      if (/목적/.test(name)) out.push(`- ${clip(prompt.replace(/\s+/g, " "), 90)} 관련 검토를 진행하고자 함`);
      else if (/범위/.test(name)) out.push(`- 검토 대상: ${[...new Set(r.slice(0, 6).map(x => x.a.title))].slice(0, 3).join(", ")}`);
      else if (/비교표/.test(name)) out.push(...compareTable(r, ts));
      else if (/관련 규정 현황/.test(name)) { out.push(...factBullets(next, 2, ts, used)); out.push(...docTable(r.slice(0, 5), ts)); }
      else if (/쟁점|영향/.test(name)) { out.push(...factBullets(next, 2, ts, used, "(사실) ")); out.push("- (해석) 〔확인 필요: 담당자 해석〕", "- (가정) 〔확인 필요: 검토 전제〕"); }
      else if (/예산|일정/.test(name)) out.push("- 〔확인 필요: 소요 예산〕", "- 〔확인 필요: 추진 일정〕");
      else if (/의견|시사점|리스크|불확실|권고|건의|향후|계획/.test(name)) out.push("- 〔확인 필요: 위 근거 조문을 바탕으로 한 담당자 판단〕");
      else out.push(...factBullets(next, typeName === "임원 보고" ? 2 : 3, ts, used, /차이/.test(name) ? "" : ""));
    }
    return out.join("\n");
  }
  function docTable(rs, ts) {
    if (!rs.length) return [];
    return ["| 근거 | 국가 | 주요 내용 |", "|---|---|---|", ...rs.map(x => `| ${x.a.label} | ${x.a.country || "-"} | ${clip(x.s, 70).replace(/\|/g, "/")} ${cite(x.a)} |`)];
  }
  function compareTable(r, ts) {
    const cs = [...new Set(r.map(x => x.a.country).filter(Boolean))].slice(0, 3);
    if (!cs.length) return ["- 근거 없음 — 비교할 국가별 조문이 없습니다."];
    const pick = c => r.filter(x => x.a.country === c);
    const cell = (c, i, f) => { const x = pick(c)[i]; return x ? f(x) : "근거 없음"; };
    return [
      `| 비교 항목 | ${cs.join(" | ")} |`, `|${"---|".repeat(cs.length + 1)}`,
      `| 관련 조문 | ${cs.map(c => cell(c, 0, x => `${x.a.label} ${cite(x.a)}`)).join(" | ")} |`,
      `| 핵심 내용 | ${cs.map(c => cell(c, 0, x => clip(x.s, 60).replace(/\|/g, "/") + " " + cite(x.a))).join(" | ")} |`,
      `| 추가 근거 | ${cs.map(c => cell(c, 1, x => `${x.a.label} ${cite(x.a)}`)).join(" | ")} |`,
      `| 당사 영향 | ${cs.map(() => "〔확인 필요〕").join(" | ")} |`,
    ];
  }

  /* ---------- 5) contract (standard clause skeleton + cited compliance clause) ---------- */
  function contractDoc(input, r, ts, topic, toName) {
    const langLine = (input.match(/\[계약서 언어\] (.*)/) || [])[1] || "";
    const lang = /KO: /.test(langLine) ? "both" : /한국어로 쓴다/.test(langLine) && !/영어로/.test(langLine) ? "ko" : "en";
    const REG = ["inside information", "insider", "market abuse", "confidential", "professional secrecy", "미공개중요정보", "내부자", "불공정거래", "비밀", "기밀", "security token", "토큰증권"];
    const reg = ranked(r.map(x => x.a), REG).filter(x => x.score >= 2).slice(0, 2);
    const pl = String(input).toLowerCase();
    const purposeEn = /토큰증권|security token/.test(pl) ? "a potential cooperation relating to security tokens"
      : /스테이블코인|stablecoin/.test(pl) ? "a potential cooperation relating to stablecoins"
      : /수탁|custody/.test(pl) ? "a potential cooperation relating to digital asset custody"
      : /가상자산|crypto|virtual asset/.test(pl) ? "a potential cooperation relating to digital assets"
      : "a potential business cooperation 〔확인 필요: 협력 목적〕";
    const purposeKo = /토큰증권|security token/.test(pl) ? "토큰증권 관련 협력 검토" : /스테이블코인|stablecoin/.test(pl) ? "스테이블코인 관련 협력 검토"
      : /수탁|custody/.test(pl) ? "디지털 자산 수탁 관련 협력 검토" : /가상자산|crypto|virtual asset/.test(pl) ? "디지털 자산 관련 협력 검토" : "협력 검토 〔확인 필요: 협력 목적〕";
    const B = toName || "〔확인 필요: 상대방 정식 법인명〕";
    const EN = [
      ["# MUTUAL NON-DISCLOSURE AGREEMENT"],
      [`This Mutual Non-Disclosure Agreement (the "Agreement") is entered into on 〔확인 필요: 계약일〕 between Hanwha Investment & Securities Co., Ltd. and ${B} 〔확인 필요: 등록번호·주소〕 (each a "Party") in connection with ${purposeEn} (the "Purpose").`, `이 상호 비밀유지계약(이하 "본 계약")은 〔확인 필요: 계약일〕 한화투자증권 주식회사와 ${B} 〔확인 필요: 등록번호·주소〕(각 "당사자") 간에 ${purposeKo}(이하 "목적")와 관련하여 체결된다.`],
      ["## Article 1. Definitions", "## 제1조 (정의)"],
      ['- "Confidential Information" means all non-public information disclosed by a Party in connection with the Purpose, in any form.', '- "비밀정보"란 목적과 관련하여 일방 당사자가 형태를 불문하고 공개한 모든 비공개 정보를 말한다.'],
      ["## Article 2. Confidentiality Obligations", "## 제2조 (비밀유지 의무)"],
      ["- The receiving Party shall keep Confidential Information strictly confidential and use it solely for the Purpose.", "- 수령 당사자는 비밀정보를 엄격히 비밀로 유지하고 목적 범위에서만 사용한다."],
      ["- Disclosure is limited to directors, employees and professional advisers who need to know and are bound by equivalent obligations.", "- 공개는 업무상 알아야 할 필요가 있고 동등한 의무를 부담하는 임직원 및 전문 자문인에 한한다."],
      ["## Article 3. Exceptions", "## 제3조 (예외)"],
      ["- Obligations do not apply to information that is or becomes public without breach, was lawfully known before disclosure, or is independently developed.", "- 계약 위반 없이 공개된 정보, 공개 전 적법하게 알고 있던 정보, 독자적으로 개발한 정보에는 적용하지 아니한다."],
      ["## Article 4. Disclosure Required by Law", "## 제4조 (법령상 공개)"],
      ["- If disclosure is required by law or a competent authority, the receiving Party shall, where lawful, give prompt notice and disclose only the required portion.", "- 법령 또는 감독기관이 공개를 요구하는 경우, 수령 당사자는 허용되는 범위에서 지체 없이 통지하고 필요한 부분만 공개한다."],
      ["## Article 5. Regulatory Compliance", "## 제5조 (규제 준수)"],
      ...(reg.length
        ? [[`- Each Party acknowledges that Confidential Information may include inside information and shall comply with all applicable restrictions on the use and disclosure of such information ${reg.map(x => cite(x.a)).join("")}.`,
            `- 각 당사자는 비밀정보에 미공개중요정보가 포함될 수 있음을 인정하고, 관련 법령상 그 이용 및 공개 제한을 준수한다 ${reg.map(x => cite(x.a)).join("")}.`],
           ["- Neither Party shall trade, or encourage any person to trade, on the basis of Confidential Information that constitutes inside information.",
            "- 어느 당사자도 미공개중요정보에 해당하는 비밀정보를 이용하여 거래하거나 타인에게 거래를 권유하지 아니한다."]]
        : [["- 〔확인 필요: 적용 규제 근거〕", "- 〔확인 필요: 적용 규제 근거〕"]]),
      ["## Article 6. Return or Destruction", "## 제6조 (반환 및 파기)"],
      ["- Upon request or termination, the receiving Party shall return or destroy Confidential Information, subject to legal retention requirements.", "- 요청 또는 계약 종료 시 수령 당사자는 법령상 보존 의무를 제외하고 비밀정보를 반환하거나 파기한다."],
      ["## Article 7. No Licence or Commitment", "## 제7조 (권리 불부여 및 거래 확약 없음)"],
      ["- No licence is granted and neither Party is obliged to enter into any further transaction.", "- 본 계약은 어떠한 권리도 부여하지 않으며, 어느 당사자도 추가 거래 체결 의무를 부담하지 아니한다."],
      ["## Article 8. Term", "## 제8조 (계약 기간)"],
      ["- This Agreement remains in force for 〔확인 필요: 기간〕, and confidentiality obligations survive for 〔확인 필요: 존속 기간〕 after termination.", "- 본 계약은 〔확인 필요: 기간〕 동안 유효하며, 비밀유지 의무는 종료 후 〔확인 필요: 존속 기간〕 동안 존속한다."],
      ["## Article 9. Governing Law and Dispute Resolution", "## 제9조 (준거법 및 분쟁해결)"],
      ["- This Agreement is governed by 〔확인 필요: 준거법 — ADGM 법 또는 대한민국 법〕, and disputes are submitted to 〔확인 필요: 관할 법원·중재〕.", "- 본 계약의 준거법은 〔확인 필요: 준거법 — ADGM 법 또는 대한민국 법〕으로 하며, 분쟁은 〔확인 필요: 관할 법원·중재〕에 따른다."],
    ];
    const out = [];
    for (const [en, ko] of EN) {
      if (lang === "ko") out.push(ko || en);
      else if (lang === "both" && ko && !en.startsWith("#")) out.push(en, "KO: " + ko.replace(/^- /, ""));
      else if (lang === "both" && en.startsWith("## ")) out.push(`${en} (${(ko || "").replace(/^## /, "")})`);
      else out.push(en);
    }
    if (lang === "ko") out[0] = "# 상호 비밀유지계약서";
    out.push("## 검토 메모",
      "- 데모 모드 초안: 표준 NDA 조항 틀에 검색된 규제 근거를 연결한 것이며, AI(Gemini) 연결 시 요청 맥락에 맞춘 초안이 생성됨",
      ...(reg.length ? reg.map(x => `- 반영 근거: ${x.a.title} ${x.a.label} ${cite(x.a)}`) : ["- 반영할 규제 근거를 찾지 못함 — 추가 원문 필요"]),
      "- 당사자 정보, 계약일, 기간, 준거법·관할은 〔확인 필요〕 — 법무 검토 필수");
    return out.join("\n");
  }

  /* ---------- dispatcher ---------- */
  function respond(input, json) {
    if (json) {
      if (/"rows"/.test(input)) return compareJson(input);
      if (/"standalone"/.test(input)) {
        const q = between(input, "[마지막 질문]\n", /\n\nJSON만/);
        const e = expand(q);
        // English-language jurisdictions: search with English terms so Korean articles don't crowd them out
        if (foreign(q)) return { standalone: e.en.join(" "), ko: [], en: e.en };
        return { standalone: q, ...e };
      }
      const q = between(input, "질문: ", /\n/) || between(input, "디지털 자산 규제 쟁점: ", /\n/) || (input.includes("[작성 요청]") ? input.split("\n\n조문 본문에")[0] : "") || input.slice(0, 300);
      const e = expand(q);
      const own = input.includes("[작성 요청]") ? between(input, "[작성 요청]\n", /\n\n/) : q;   // judge language by the user's request only
      return foreign(own) ? { ko: [...e.ko].filter(w => /[a-z]/i.test(w)), en: e.en } : e;
    }
    if (input.includes("[작성할 문서]")) return draftDoc(input);
    if (input.includes("[이번 질문]")) return chatAnswer(input);
    return qaAnswer(input);
  }

  window.DALI_MOCK = { respond, expand, terms };
})();
