// Built by codex/build.mjs from hooks/recap.ts, client.ts and journal.ts: edit those, then rebuild.
// ../hooks/client.ts
var F = "";
var FF = "";
var C = "";
var ANY = `[${F}${FF}${C}]`;
var FILE_EXT = "tsx?|jsx?|mjs|cjs|json|md|html?|css|scss|py|rb|go|rs|java|kt|swift|sh|ps1|ya?ml|toml|lock|sql|txt|env|xml|csv|ini|cfg|conf|log|php|vue|svelte";
var NOT_A_NOUN = /* @__PURE__ */ new Set(["now", "is", "was", "are", "were", "has", "had", "have", "will", "can", "could", "should", "would", "no", "also", "still", "then", "and", "or", "but", "so", "loads", "works", "runs", "shows", "opens", "saves"]);
var ARTICLE = "(the|a|an|this|that|your|our|its)";
var capitalise = (s) => s.replace(/(^|[.!?]\s+)([a-z])/g, (_, a, b) => a + b.toUpperCase());
var forClient = (s) => {
  let t = ` ${s} `.replace(/`[^`]*`/g, C).replace(/\b[A-Za-z]:[\\/](?:[^\s,;)]*[^\s,;).!?:])?/g, F).replace(new RegExp(`(^|\\s)(?:~|\\.{1,2})?\\/?(?:[\\w.-]+\\/)+[\\w-]+\\.(?:${FILE_EXT})\\b`, "gi"), `$1${F}`).replace(/(^|\s)(?:~|\.{1,2})?\/?(?:[\w.-]+\/){2,}[\w.-]*/g, `$1${F}`).replace(new RegExp(`\\b[\\w-]+\\.(?:${FILE_EXT})\\b`, "gi"), F).replace(/\b(the|a|an)\s+v?\d+\.\d+\.\d+\b/gi, "the new version").replace(/\bv?\d+\.\d+\.\d+\b/g, "the new version");
  t = t.replace(new RegExp(`${ANY}(?:\\s*(?:,|and|or|&)\\s*${ANY})+`, "g"), (m) => m.includes(C) && !m.includes(F) && !m.includes(FF) ? C : FF);
  t = t.replace(new RegExp(`\\s*\\b(?:in|inside|within|to|from|of|on|at|into|under|across|via)\\s+(?:the\\s+)?${ANY}`, "gi"), "");
  t = t.replace(new RegExp(`\\b${ARTICLE}\\s+${ANY}\\s+([a-z]+)`, "gi"), (m, art, word) => NOT_A_NOUN.has(word.toLowerCase()) ? m : `${art} ${word}`);
  t = t.replace(new RegExp(`\\b${ARTICLE}\\s+(${ANY})`, "gi"), (_, art, tok) => `${art} ${tok === FF ? "files" : tok === C ? "code" : "file"}`);
  t = t.replace(new RegExp(F, "g"), "a file").replace(new RegExp(FF, "g"), "a few files").replace(new RegExp(C, "g"), "the code").replace(/\s+([,.;:!?])/g, "$1").replace(/([,;:])(?=[.!?])/g, "").replace(/^[\s,;:]+/, "").replace(/\s+/g, " ").trim();
  return capitalise(t);
};
var STATUS = { done: "Done", in_progress: "In progress", blocked: "Waiting on a decision" };
var TONES = {
  friendly: { label: "Friendly" },
  formal: { label: "Formal" },
  short: { label: "Very short" }
};
var DEFAULT_CLIENT = { name: "", signoff: "", tone: "friendly" };
var firstSentence = (s) => (s.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? s).trim();
var clientNote = (r, next, settings = DEFAULT_CLIENT, body) => {
  const text = body && body.trim() || r.client && r.client.trim() || forClient(r.tldr);
  const name = settings.name.trim();
  const signoff = settings.signoff.trim();
  const step = next ? forClient(next) : "";
  if (settings.tone === "short") {
    return [
      `${name ? `${name}: ` : ""}${firstSentence(text)} (${STATUS[r.verdict].toLowerCase()})`,
      ...step ? [`Next: ${step}`] : [],
      ...signoff ? [`\u2013 ${signoff}`] : []
    ].join("\n");
  }
  if (settings.tone === "formal") {
    return [
      name ? `Dear ${name},` : "Hello,",
      "",
      text,
      "",
      `Current status: ${STATUS[r.verdict]}.`,
      ...step ? [`Next step: ${step}.`.replace(/\.\.$/, ".")] : [],
      ...signoff ? ["", "Kind regards,", signoff] : []
    ].join("\n");
  }
  return [
    `Hi ${name || "there"},`,
    "",
    text,
    "",
    `Status: ${STATUS[r.verdict]}`,
    ...step ? [`Next up: ${step}`] : [],
    ...signoff ? ["", "Thanks,", signoff] : []
  ].join("\n");
};
var simplerPrompt = (note) => `Rewrite this progress note so anyone could follow it, even a ten-year-old: very short sentences, everyday words, one friendly comparison if it helps, no technical words, no file names, at most 4 sentences. Reply with the rewritten note only.

"""
${note.slice(0, 1500)}
"""`;
var esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
var inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
var diaryEntries = (markdown) => markdown.split(/\n## /).slice(1).map((chunk) => {
  const [date = "", ...rest] = chunk.split("\n");
  const text = rest.join("\n").trim();
  const head = text.match(/^\*\*(.+?)\.\*\*\s*/);
  const status = head?.[1] ?? "";
  const afterHead = head ? text.slice(head[0].length) : text;
  const [body = "", next = ""] = afterHead.split(/\n\n\*\*Coming up next:\*\*\s*/);
  return { date: date.trim(), status, body: body.trim(), next: next.trim() };
});
var diaryPage = (markdown, project, client, updated) => {
  const entries = diaryEntries(markdown).reverse();
  const pill = (status) => {
    const kind = /done/i.test(status) ? "done" : /waiting/i.test(status) ? "wait" : "going";
    return `<span class="pill ${kind}">${esc(status.replace(/^[^\p{L}]+/u, "")) || "Update"}</span>`;
  };
  const items = entries.length === 0 ? '<p class="empty">No updates yet.</p>' : entries.map((e) => `
    <article>
      <header><time>${esc(e.date)}</time>${pill(e.status)}</header>
      <p>${inline(e.body)}</p>
      ${e.next ? `<p class="next"><span>Coming up next</span>${inline(e.next)}</p>` : ""}
    </article>`).join("\n");
  const title = `${project}: progress updates${client ? ` for ${client}` : ""}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<style>
  :root { --bg: #faf8f5; --card: #ffffff; --ink: #24201c; --dim: #6f675f; --line: #e8e2da; --done: #2f7d4f; --going: #a86b00; --wait: #8a5cc4; }
  @media (prefers-color-scheme: dark) { :root { --bg: #1b1916; --card: #24211d; --ink: #f1ece6; --dim: #a59c92; --line: #38332d; --done: #6fcf97; --going: #f2b94b; --wait: #c3a2f2; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 17px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 680px; margin: 0 auto; padding: 48px 16px 64px; }
  h1 { font-size: 1.7rem; line-height: 1.25; margin: 0 0 4px; }
  .sub { color: var(--dim); margin: 0 0 32px; }
  article { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 18px 20px; margin: 0 0 14px; }
  article header { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 6px; }
  time { font-weight: 600; }
  .pill { font-size: .8rem; font-weight: 600; padding: 2px 10px; border-radius: 99px; border: 1px solid currentColor; }
  .pill.done { color: var(--done); } .pill.going { color: var(--going); } .pill.wait { color: var(--wait); }
  article p { margin: 6px 0 0; }
  .next { color: var(--dim); }
  .next span { display: block; font-size: .8rem; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
  .empty { color: var(--dim); }
  footer { color: var(--dim); font-size: .85rem; margin-top: 28px; }
</style>
</head>
<body>
<main>
  <h1>${esc(project)}: progress updates</h1>
  <p class="sub">${client ? `For ${esc(client)} \xB7 ` : ""}${entries.length} update${entries.length === 1 ? "" : "s"}, newest first</p>
  ${items}
  <footer>Last updated ${esc(updated)}.</footer>
</main>
</body>
</html>
`;
};

// ../hooks/recap.ts
var one = (t, max) => {
  const s = String(t ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}\u2026` : s;
};
var isWorthRecap = (log, answer, isAborted) => !isAborted && answer.trim().length > 0 && (log.edits >= 1 || log.research >= 3 || log.tools >= 5);
var LANES = {
  fix: { icon: "\u{1F41E}", name: "Fix", color: "#F2777B" },
  debt: { icon: "\u{1F9F9}", name: "Tech debt", color: "#9AA4B2" },
  feature: { icon: "\u2728", name: "Features", color: "#6A9BCC" },
  design: { icon: "\u{1F3A8}", name: "UI & design", color: "#E88AB4" },
  money: { icon: "\u{1F4B0}", name: "Money", color: "#3FB950" },
  growth: { icon: "\u{1F4E3}", name: "Growth & leads", color: "#E5A84D" },
  ship: { icon: "\u{1F680}", name: "Ship & ops", color: "#56C1C9" },
  wild: { icon: "\u{1F9EA}", name: "Wild ideas", color: "#A487E0" }
};
var LANE_KEYS = Object.keys(LANES);
var SHAPE = `Reply with JSON only, no code fence, exactly these keys:
"tldr": at most 20 words: what was done and the outcome
"verdict": "done" when the goal the person asked for is fully reached and verified, "in_progress" when part of it remains, "blocked" when it cannot go on without the person
"verdict_why": at most 12 words
"client": 2 to 4 short sentences the person can send their client as a progress update: what changed for the client or their customers, why it matters, and what is next. Warm and plain, no file names, code, tool names, version numbers or technical words
"options": 28 to 40 possible next moves for this project, as varied and creative as you can make them, so the person can scan them all and pick the vital few. Think first from the point of view of the project's customers or users: what would make them happier, trust it more, come back, pay or tell a friend. Use everything you saw in the code and the conversation: bugs, inconsistencies, shortcuts, missed opportunities, and where the project could go. Cover at least 6 of these lanes:
  "fix": bugs, broken or unverified things
  "debt": refactors, inconsistencies, cleanup, missing tests
  "feature": new or better product capability
  "design": UI, UX, look and feel, wording
  "money": revenue, pricing, monetisation
  "growth": users, leads, marketing, distribution
  "ship": deploying, releasing, monitoring, operations
  "wild": fresh, bold or creative bets the person probably has not thought of (at least 6 of these)
Each option is {"title": at most 9 plain words, "detail": at most 18 words on what it is and why it matters, "lanes": 1 to 3 lane keys, most related first, "impact": 1 to 5 for the value if done, "effort": "S", "M" or "L", "needs_you": true when it turns on the person's own taste, ideas or business knowledge (a new feature, a design direction, pricing), false when it can be done well from the code alone (bugs, refactors, tests, deploys), "prompt": the prompt that asks for it, first person, imperative, at most 35 words, "borrowed": only for an idea taken from the person's other projects (when any are listed): that project's name; otherwise leave it out}.
The person is not very technical: write titles and details in plain language, and never plan to ask them technical questions.`;
var savedNote = (saved) => saved.length === 0 ? "" : `
The person saved these for later (newest first). Bring back, with the exact same title, any that still matter after this turn:
${saved.slice(0, 30).map((s) => `- ${s.title}${s.pack ? ` (saved with "${s.pack}")` : ""}`).join("\n")}
`;
var borrowNote = (ideas) => ideas.length === 0 ? "" : `
Ideas the person picked and ran in their other projects. Where one would genuinely help this project too, include it as an option adapted to this project, with "borrowed" set to that project's name; skip any that do not fit:
${ideas.slice(0, 15).map((i) => `- ${i.title} (from ${i.project})`).join("\n")}
`;
var SYSTEM = `You recap a coding assistant's finished work against the goal the person asked for, then lay out what could come next.
Be accurate to what was actually done and verified; never invent results.
${SHAPE}`;
var promptFor = (log, answer, saved = [], ideas = []) => {
  const steps = log.steps.length > 0 ? log.steps.map((s) => `- ${s}`).join("\n") : "- (no tools)";
  return `The person asked:
${one(log.ask, 1200) || "(continuation of earlier work)"}

What the assistant did, in order:
${steps}

The assistant's final reply:
${answer.slice(0, 6e3)}${savedNote(saved)}${borrowNote(ideas)}`;
};
var plain = (x, max = 400) => {
  if (typeof x !== "string") return "";
  const s = x.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, " ").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}\u2026` : s;
};
var md = (s) => s.replace(/[\\`*_{}\[\]()#+\-.!<>|~]/g, (c) => `\\${c}`);
var list = (x) => Array.isArray(x) ? x : [];
var VERDICTS = /* @__PURE__ */ new Set(["done", "in_progress", "blocked"]);
var EFFORTS = /* @__PURE__ */ new Set(["S", "M", "L"]);
var parseTakes = (text, projects = []) => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const j = JSON.parse(text.slice(start, end + 1));
    const tldr = plain(j.tldr, 200);
    if (!tldr || !VERDICTS.has(j.verdict)) return null;
    const options = list(j.options).map((o, i) => {
      const lanes = [...new Set(list(o?.lanes).filter((l) => l in LANES))].slice(0, 3);
      const impact = Math.min(5, Math.max(1, Math.round(Number(o?.impact) || 3)));
      const from = plain(o?.borrowed, 60).toLowerCase();
      const borrowed = from ? projects.find((p) => p.toLowerCase() === from) : void 0;
      return {
        ...borrowed ? { borrowed } : {},
        id: `o${i}`,
        title: plain(o?.title, 90),
        detail: plain(o?.detail, 200),
        lanes: lanes.length > 0 ? lanes : ["feature"],
        impact,
        effort: EFFORTS.has(o?.effort) ? o.effort : "M",
        needsYou: o?.needs_you === true,
        prompt: plain(o?.prompt, 300)
      };
    }).filter((o) => o.title && o.prompt).slice(0, 40);
    if (options.length === 0) return null;
    return { tldr, verdict: j.verdict, verdictWhy: plain(j.verdict_why, 120), client: forClient(plain(j.client, 600)), options };
  } catch {
    return null;
  }
};
var rememberWins = (wins, picked, project, now) => {
  const fresh = picked.map((o) => ({ title: o.title, detail: o.detail, prompt: o.prompt, lanes: o.lanes, effort: o.effort, project, at: now }));
  const key = (w) => `${w.project.toLowerCase()}|${w.title.toLowerCase()}`;
  const seen = new Set(fresh.map(key));
  return [...fresh, ...wins.filter((w) => w && typeof w.title === "string" && !seen.has(key(w)))].slice(0, 80);
};
var borrowable = (wins, project) => {
  const out = [];
  for (const w of wins) {
    if (!w || typeof w.title !== "string" || typeof w.project !== "string") continue;
    if (w.project.toLowerCase() === project.toLowerCase()) continue;
    if (out.some((o) => o.title.toLowerCase() === w.title.toLowerCase())) continue;
    out.push({ title: w.title, project: w.project });
  }
  return out.slice(0, 15);
};
var EFFORT_COST = { S: 1, M: 1.25, L: 1.6 };
var LEARN_LIFT = 0.3;
var LEARN_MIN = 3;
var affinity = (learned) => {
  const counts = Object.values(learned).filter((n) => typeof n === "number");
  const total = counts.reduce((a, b) => a + b, 0);
  const top = Math.max(0, ...counts);
  if (total < LEARN_MIN || top === 0) return {};
  const out = {};
  for (const l of LANE_KEYS) if (learned[l]) out[l] = learned[l] / top;
  return out;
};
var score = (o, learned = {}) => {
  const lean = affinity(learned);
  const habit = Math.max(0, ...o.lanes.map((l) => lean[l] ?? 0));
  return o.impact * (1 + 0.4 * (o.lanes.length - 1)) / EFFORT_COST[o.effort] * (1 + LEARN_LIFT * habit);
};
var ranked = (options, learned = {}) => options.map((o, i) => ({ o, i, s: score(o, learned) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.o);
var topPicks = (options, learned = {}) => new Set(ranked(options, learned).slice(0, 3).map((o) => o.id));
var bestInLane = (options, learned = {}) => {
  const best = /* @__PURE__ */ new Map();
  for (const o of ranked(options, learned)) for (const l of o.lanes) if (!best.has(l)) best.set(l, o.id);
  return best;
};
var learnFrom = (learned, picked) => {
  const out = { ...learned };
  for (const o of picked) for (const l of o.lanes) out[l] = (out[l] ?? 0) + 1;
  return out;
};
var favourites = (learned) => {
  const lean = affinity(learned);
  return Object.keys(lean).filter((l) => (lean[l] ?? 0) >= 0.6).sort((a, b) => (lean[b] ?? 0) - (lean[a] ?? 0)).slice(0, 3);
};
var isSaved = (backlog, o) => backlog.some((b) => b.title === o.title && b.prompt === o.prompt);
var toggleSaved = (backlog, o, now) => isSaved(backlog, o) ? backlog.filter((b) => !(b.title === o.title && b.prompt === o.prompt)) : [{ ...o, id: freshId(backlog, now), savedAt: now }, ...backlog].slice(0, 100);
var freshId = (backlog, now) => {
  const taken = new Set(backlog.map((b) => b.id));
  let n = 0;
  while (taken.has(`bk-${now.toString(36)}-${n}`)) n++;
  return `bk-${now.toString(36)}-${n}`;
};
var DEPLOY = {
  local: { label: "Keep it local", text: "Keep it local for now; do not deploy anything." },
  staging: { label: "Staging", text: "Once it works locally, deploy to staging and check it there." },
  production: { label: "Production", text: "Once it works, deploy to production and check it is live and working." }
};
var AUTONOMY = {
  auto: { label: "Auto", hint: "interview me only when a pick needs my ideas" },
  interview: { label: "Interview me first", hint: "questions before work" },
  solo: { label: "Just do it", hint: "no questions, your call" }
};
var INTERVIEW = "Before you start, interview me with the recap interview tool: up to 5 short, plain-language multiple-choice questions about what I want (goals, taste, priorities). I am not technical, so make every technical decision yourself.";
var INTERVIEW_PLAIN = "Before you start, ask me up to 5 short, plain-language multiple-choice questions about what I want (goals, taste, priorities), numbered, each with lettered answers, then wait for my answers. I am not technical, so make every technical decision yourself.";
var SOLO = "Do not stop to ask me questions: make sensible decisions yourself and tell me briefly what you chose.";
var sentence = (t) => /[.!?]$/.test(t) ? t : `${t}.`;
var clause = (t) => t.replace(/[.!?]$/, "");
var willInterview = (picked, autonomy) => autonomy === "interview" || autonomy === "auto" && picked.some((o) => o.needsYou);
var composePrompt = (options, chosen, deploy, autonomy, interview = INTERVIEW) => {
  const picked = chosen.map((id) => options.find((o) => o.id === id)).filter((o) => o !== void 0);
  const [main, ...rest] = picked;
  if (main === void 0) return "";
  const parts = [sentence(main.prompt)];
  const [only] = rest;
  if (rest.length === 1 && only) parts.push(`Also ${clause(only.prompt).replace(/^./, (c) => c.toLowerCase())}.`);
  else if (rest.length > 1) parts.push(`Also:
${rest.map((o) => `- ${clause(o.prompt)}`).join("\n")}`);
  parts.push(DEPLOY[deploy].text);
  parts.push(willInterview(picked, autonomy) ? interview : SOLO);
  return parts.join("\n\n");
};

// ../hooks/journal.ts
var dataDir = (home) => `${home.replace(/\\/g, "/").replace(/\/+$/, "")}/.claude/recap`;
var projectKey = (cwd) => cwd.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
var projectName = (cwd) => cwd.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() || "project";
var diaryFile = (dir, cwd) => {
  const key = projectKey(cwd);
  let h = 0;
  for (const c of key) h = h * 31 + c.charCodeAt(0) >>> 0;
  const name = projectName(cwd).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
  return `${dir}/diary/${name}-${h.toString(36)}.md`;
};
var skipReason = (log, answer, isAborted) => {
  if (isAborted) return "the turn was interrupted";
  if (!answer.trim()) return "Claude gave no reply";
  if (log.edits >= 1 || log.research >= 3 || log.tools >= 5) return null;
  if (log.tools === 0) return "nothing was changed, it was just a chat";
  return "too little was changed or looked up";
};
var diaryHeader = (cwd, client = "") => `# ${projectName(cwd)}: progress updates${client.trim() ? ` for ${client.trim()}` : ""}

A running record of the work, newest last. Each update is added when a piece of work finishes.
`;
var withHeader = (diary, header) => {
  const at = diary.indexOf("\n## ");
  return at < 0 ? header : header + diary.slice(at);
};
var nextStreak = (streak, verdict) => verdict === "done" ? streak + 1 : 0;
var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
var STATUS2 = { done: "\u2705 Done", in_progress: "\u{1F7E1} In progress", blocked: "\u23F8 Waiting on a decision" };
var diaryEntry = (r, at, next) => {
  const d = new Date(at);
  const date = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const body = r.client && r.client.trim() || forClient(r.tldr);
  const coming = next ? `

**Coming up next:** ${forClient(next)}` : "";
  return `
## ${date}

**${STATUS2[r.verdict]}.** ${body}${coming}
`;
};
var appendLine = (existing, line, keep = 2e3) => {
  const lines = existing.split("\n").filter(Boolean);
  lines.push(line);
  return `${lines.slice(-keep).join("\n")}
`;
};
export {
  AUTONOMY,
  DEFAULT_CLIENT,
  DEPLOY,
  INTERVIEW_PLAIN,
  LANES,
  LANE_KEYS,
  SYSTEM,
  TONES,
  appendLine,
  bestInLane,
  borrowable,
  clientNote,
  composePrompt,
  dataDir,
  diaryEntries,
  diaryEntry,
  diaryFile,
  diaryHeader,
  diaryPage,
  favourites,
  forClient,
  isSaved,
  isWorthRecap,
  learnFrom,
  md,
  nextStreak,
  parseTakes,
  plain,
  projectKey,
  projectName,
  promptFor,
  ranked,
  rememberWins,
  simplerPrompt,
  skipReason,
  toggleSaved,
  topPicks,
  willInterview,
  withHeader
};
