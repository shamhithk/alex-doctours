/**
 * Local observability dashboard. Collects traces and eval reports and writes a
 * single self-contained, offline HTML file (no server, no network, no accounts).
 *
 *   npm run dashboard            # writes dashboard.html and opens it
 *   npm run dashboard -- --no-open --out /tmp/d.html --max-runs 6
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
const flag = (k: string) => argv.includes(`--${k}`);
const opt = (k: string, d: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const OUT = resolve(opt("out", "dashboard.html"));
const MAX_RUNS = Number(opt("max-runs", "8"));

const readJsonl = (p: string) =>
  readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
const files = (dir: string, re: RegExp) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => re.test(f))
        .map((f) => join(dir, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    : [];

/** Keep what the UI needs; the full system prompt only for small ad-hoc trace files. */
function slim(t: any, keepPrompt: boolean) {
  const out = { ...t };
  if (!keepPrompt && out.prompt) out.prompt = { approxTokens: out.prompt.approxTokens };
  return out;
}

const traceSets: { key: string; label: string; kind: "run" | "adhoc"; traces: any[] }[] = [];
for (const f of [...files("traces", /\.jsonl$/), ...files("examples", /\.jsonl$/)]) {
  traceSets.push({ key: f, label: `${basename(f)} (CLI)`, kind: "adhoc", traces: readJsonl(f).map((t) => slim(t, true)) });
}
const runs: any[] = [];
for (const f of files("eval/results", /^(?!baseline-|toolcalling-).*-k\d+-.*\.json$/).slice(0, MAX_RUNS)) {
  const report = JSON.parse(readFileSync(f, "utf8"));
  const tf = f.replace(/\.json$/, ".traces.jsonl");
  runs.push({ key: f, label: basename(f).replace(/\.json$/, ""), summary: report.summary, rows: report.rows, hasTraces: existsSync(tf) });
  if (existsSync(tf)) traceSets.push({ key: f, label: `${basename(f, ".json")} (eval)`, kind: "run", traces: readJsonl(tf).map((t) => slim(t, false)) });
}
const baselines = files("eval/results", /^baseline-.*\.json$/).map((f) => ({ key: f, summary: JSON.parse(readFileSync(f, "utf8")).summary }));
const toolcalling = files("eval/results", /^toolcalling-.*\.json$/).slice(0, 3).flatMap((f) => JSON.parse(readFileSync(f, "utf8")));

const data = { generatedAt: new Date().toISOString(), runs, baselines, toolcalling, traceSets };
const payload = JSON.stringify(data).replace(/</g, "\\u003c");
writeFileSync(OUT, HTMLTemplate().replace("__DATA__", () => payload));
const kb = Math.round(Buffer.byteLength(payload) / 1024);
console.error(`dashboard: ${OUT} (${traceSets.reduce((a, s) => a + s.traces.length, 0)} traces, ${runs.length} eval runs, ${kb} KB)`);
if (!flag("no-open")) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", OUT] : [OUT];
  spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => console.error(`open ${OUT} in a browser`)).unref();
}

// --------------------------------------------------------------------------- page
function HTMLTemplate() {
  return String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reply Trace Console</title>
<style>
:root{--bg:#f5f6f8;--panel:#fff;--ink:#141821;--muted:#5b6475;--faint:#8a93a4;--line:#e3e6ec;--soft:#eef0f4;
--accent:#3b5bdb;--ok:#2b8a3e;--ok-soft:#e6f4ea;--bad:#c92a2a;--bad-soft:#fdecec;--warn:#b35c00;--warn-soft:#fff3e0;
--k-guard:#7048e8;--k-router:#1c7ed6;--k-tool:#e8590c;--k-llm:#0c8599;--k-eval:#c2255c;--k-commit:#5c677d;--k-step:#adb5bd;
--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#0e1116;--panel:#161a22;--ink:#e6e9ef;--muted:#a0a8b8;--faint:#6f7889;--line:#262c38;--soft:#1d222c;
--accent:#748ffc;--ok:#69db7c;--ok-soft:#15261a;--bad:#ff8787;--bad-soft:#2c1618;--warn:#ffa94d;--warn-soft:#2b2012;color-scheme:dark}}
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 var(--sans)}
header{display:flex;align-items:center;gap:18px;padding:0 20px;height:52px;background:var(--panel);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5}
header h1{font-size:15px;margin:0;font-weight:650;letter-spacing:-.01em;white-space:nowrap}@media (max-width:760px){header .gen{display:none}}
header .gen{margin-left:auto;color:var(--faint);font:12px var(--mono)}
nav{display:flex;gap:4px}nav button{border:0;background:none;color:var(--muted);font:500 13px var(--sans);padding:8px 12px;border-radius:6px;cursor:pointer}
nav button[aria-selected=true]{background:var(--soft);color:var(--ink)}
main{padding:20px;max-width:1500px;margin:0 auto}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:22px 0 10px;font-weight:600}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.tile{padding:14px 16px}.tile b{display:block;font-size:24px;font-weight:650;font-variant-numeric:tabular-nums;letter-spacing:-.02em}.tile span{color:var(--muted);font-size:12px}
table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;color:var(--faint);font:500 11px var(--sans);text-transform:uppercase;letter-spacing:.05em;padding:9px 12px;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}tr:last-child td{border-bottom:0}.num{font-variant-numeric:tabular-nums;font-family:var(--mono);font-size:12.5px;white-space:nowrap}
.tbl{overflow:auto}
.chip{display:inline-block;font:500 11px var(--mono);padding:1px 7px;border-radius:999px;background:var(--soft);color:var(--muted);white-space:nowrap;margin:1px 2px 1px 0}
.chip.ok{background:var(--ok-soft);color:var(--ok)}.chip.bad{background:var(--bad-soft);color:var(--bad)}.chip.warn{background:var(--warn-soft);color:var(--warn)}.chip.acc{background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent)}
.split{display:grid;grid-template-columns:360px minmax(0,1fr);gap:16px;align-items:start}
@media (max-width:900px){.split{grid-template-columns:1fr}}
.list{max-height:calc(100vh - 150px);overflow:auto}
.filters{display:flex;flex-wrap:wrap;gap:8px;padding:10px;border-bottom:1px solid var(--line)}
select,input[type=search]{font:13px var(--sans);color:var(--ink);background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:6px 8px}input[type=search]{flex:1;min-width:120px}
.item{padding:10px 12px;border-bottom:1px solid var(--line);cursor:pointer;display:grid;gap:3px}.item:hover{background:var(--soft)}.item[aria-current=true]{background:color-mix(in srgb,var(--accent) 10%,transparent);box-shadow:inset 3px 0 0 var(--accent)}
.item .msg{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.item .meta{display:flex;gap:6px;align-items:center;color:var(--faint);font:12px var(--mono)}
.detail{padding:18px 20px;display:grid;gap:16px;min-width:0}.detail>*,.cols>*,.split>*{min-width:0}code{word-break:break-all;font:12px var(--mono)}
.dh{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.dh h3{margin:0;font-size:16px;font-weight:600;flex-basis:100%}
.sec h4{margin:0 0 8px;font:600 12px var(--sans);text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.wf{display:grid;gap:4px}.wf-row{display:grid;grid-template-columns:190px 1fr 70px;gap:10px;align-items:center;font-size:12.5px}
.wf-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--muted)}.wf-name b{color:var(--ink);font-weight:550}
.wf-track{position:relative;height:16px;background:var(--soft);border-radius:4px}.wf-bar{position:absolute;top:2px;bottom:2px;border-radius:3px;min-width:3px}
.wf-dur{text-align:right;font:12px var(--mono);color:var(--faint)}
.k-guard{background:var(--k-guard)}.k-router{background:var(--k-router)}.k-tool{background:var(--k-tool)}.k-llm{background:var(--k-llm)}.k-eval{background:var(--k-eval)}.k-commit{background:var(--k-commit)}.k-step{background:var(--k-step)}
.legend{display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:var(--muted);margin-top:6px}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}
.bars{display:grid;gap:5px}.bar{display:grid;grid-template-columns:170px 1fr 44px;gap:10px;align-items:center;font-size:12.5px}.bar .t{height:10px;background:var(--soft);border-radius:3px;overflow:hidden}.bar .f{height:100%;background:var(--accent);border-radius:3px}.bar .f.hi{background:var(--bad)}.bar .v{font:12px var(--mono);text-align:right;color:var(--muted)}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}
.sms{max-width:520px;background:color-mix(in srgb,var(--accent) 12%,var(--panel));border:1px solid color-mix(in srgb,var(--accent) 25%,var(--line));border-radius:16px 16px 4px 16px;padding:12px 14px;white-space:pre-wrap;word-break:break-word}
.sms.esc{background:var(--warn-soft);border-color:color-mix(in srgb,var(--warn) 35%,var(--line))}
.in{max-width:520px;background:var(--soft);border-radius:16px 16px 16px 4px;padding:10px 14px;white-space:pre-wrap}
pre{margin:0;font:12px/1.5 var(--mono);background:var(--soft);border-radius:8px;padding:10px 12px;overflow:auto;max-height:420px;white-space:pre-wrap;word-break:break-word}
details{border:1px solid var(--line);border-radius:8px}details>summary{cursor:pointer;padding:8px 12px;font-size:13px;list-style:none;display:flex;gap:8px;align-items:center}details>summary::-webkit-details-marker{display:none}details>summary::before{content:"▸";color:var(--faint)}details[open]>summary::before{content:"▾"}details>div{padding:0 12px 12px}
.muted{color:var(--muted)}.empty{padding:40px;text-align:center;color:var(--faint)}
.grid{display:grid;gap:2px 4px;grid-template-columns:minmax(160px,280px) repeat(var(--n),22px);justify-content:start;align-items:center;font-size:12px}.cell{width:20px;height:18px;border-radius:3px}.cell.p{background:var(--ok)}.cell.f{background:var(--bad)}.cell.n{background:var(--soft)}
.grid .lbl{padding-right:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px;color:var(--muted)}
button.link{border:0;background:none;color:var(--accent);cursor:pointer;font:inherit;padding:0}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
</style></head><body>
<header><h1>Reply Trace Console</h1><nav role="tablist"><button role="tab" data-tab="overview" aria-selected="true">Overview</button><button role="tab" data-tab="traces" aria-selected="false">Traces</button><button role="tab" data-tab="evals" aria-selected="false">Eval runs</button></nav><span class="gen" id="gen"></span></header>
<main><section id="tab-overview"></section><section id="tab-traces" hidden></section><section id="tab-evals" hidden></section></main>
<script id="data" type="application/json">__DATA__</script>
<script>
const D=JSON.parse(document.getElementById('data').textContent);
const $=(s,r=document)=>r.querySelector(s);const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const ms=n=>n==null?'–':n>=1000?(n/1000).toFixed(n>=10000?0:1)+' s':Math.round(n)+' ms';
const usd=n=>n==null?'–':n===0?'$0':n<0.01?'$'+n.toFixed(5):'$'+n.toFixed(3);
const pctN=s=>parseFloat(String(s))||0;
$('#gen').textContent='generated '+D.generatedAt.replace('T',' ').slice(0,16)+' UTC';
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>show(b.dataset.tab));
function show(t){document.querySelectorAll('nav button').forEach(b=>b.setAttribute('aria-selected',b.dataset.tab===t));['overview','traces','evals'].forEach(x=>$('#tab-'+x).hidden=x!==t);try{history.replaceState(null,'','#'+t)}catch(e){}}
const allTraces=D.traceSets.flatMap(s=>s.traces.map(t=>({...t,_set:s.key,_label:s.label})));
const rowFor=(setKey,id)=>{const run=D.runs.find(r=>r.key===setKey);if(!run)return null;const[cid,n]=String(id).split('#');return run.rows.find(r=>r.id===cid&&String(r.run)===String(n??'0'))};

// ---------------- overview
(function(){
  const el=$('#tab-overview');
  if(!D.runs.length&&!allTraces.length){el.innerHTML='<div class="panel empty">No traces or eval results yet. Run <code>npm run reply -- --input … --trace traces/run.jsonl</code> or <code>npx tsx eval/run.ts</code>, then <code>npm run dashboard</code>.</div>';return}
  const best=[...D.runs].sort((a,b)=>b.summary.runs-a.summary.runs)[0];
  const s=best?.summary;
  let h='';
  if(s){h+='<h2>Latest largest eval run · '+esc(s.writer)+' · '+esc(s.router)+'</h2><div class="tiles">'+[
    [s.passRate,'pass rate ('+s.runs+' runs)'],[s.passK,'pass^'+s.k+' (every run passes)'],[s.escalationRecall,'escalation recall'],[s.escalationPrecision,'escalation precision'],
    [ms(s.latencyP50ms)+' / '+ms(s.latencyP95ms),'latency p50 / p95'],[usd(s.costPerAnsweredUsd),'cost per answered message'],[(s.promptTokensP50/1000).toFixed(1)+'k','prompt tokens / turn (p50)']
  ].map(([v,l])=>'<div class="panel tile"><b>'+esc(v)+'</b><span>'+esc(l)+'</span></div>').join('')+'</div>'}
  h+='<h2>Compare runs</h2><div class="panel tbl"><table><thead><tr><th>Variant</th><th>Writer</th><th>Router</th><th>Runs</th><th>Pass</th><th>pass^k</th><th>Esc. recall</th><th>Esc. precision</th><th>Latency p50 / p95</th><th>Cost / answered</th><th>Prompt tok p50</th><th>Repairs · fallbacks</th></tr></thead><tbody>';
  for(const r of D.runs){const x=r.summary;const wo=x.writerOutcomes||{};h+='<tr><td><button class="link" data-run="'+esc(r.key)+'">'+esc(r.label)+'</button></td><td>'+esc(x.writer)+'</td><td>'+esc(x.router)+'</td><td class="num">'+x.runs+'</td><td class="num">'+esc(x.passRate)+'</td><td class="num">'+esc(x.passK)+'</td><td class="num">'+esc(x.escalationRecall)+'</td><td class="num">'+esc(x.escalationPrecision)+'</td><td class="num">'+ms(x.latencyP50ms)+' / '+ms(x.latencyP95ms)+'</td><td class="num">'+usd(x.costPerAnsweredUsd)+'</td><td class="num">'+(x.promptTokensP50||'–')+'</td><td class="num">'+(wo.repaired||0)+' · '+(wo.fallback||0)+'</td></tr>'}
  for(const b of D.baselines){const x=b.summary;h+='<tr><td><span class="chip warn">monolith baseline</span></td><td>'+esc(x.writer)+'</td><td>none</td><td class="num">'+x.cases+'</td><td class="num">'+esc(x.passRate)+'</td><td class="num">n/a</td><td class="num">'+esc(x.escalationRecall)+'</td><td class="num">'+esc(x.escalationPrecision)+'</td><td class="num">'+ms(x.latencyP50ms)+'</td><td class="num">'+usd(x.costTotalUsd/Math.max(1,x.cases))+'</td><td class="num">'+(x.inputTokensP50||'–')+'</td><td class="num">'+(x.invalidReplies||0)+' invalid</td></tr>'}
  h+='</tbody></table></div>';
  if(D.runs.length){const mx=Math.max(...D.runs.map(r=>r.summary.latencyP95ms||0),1);const mc=Math.max(...D.runs.map(r=>r.summary.costPerAnsweredUsd||0),1e-9);
    h+='<div class="cols"><div><h2>Latency p95 by run</h2><div class="panel" style="padding:14px"><div class="bars">'+D.runs.map(r=>'<div class="bar"><span title="'+esc(r.label)+'">'+esc(r.summary.writer+' · '+r.summary.router.split(' ')[0])+'</span><span class="t"><span class="f" style="width:'+(100*(r.summary.latencyP95ms||0)/mx)+'%"></span></span><span class="v">'+ms(r.summary.latencyP95ms)+'</span></div>').join('')+'</div></div></div>'+
    '<div><h2>Cost per answered message</h2><div class="panel" style="padding:14px"><div class="bars">'+D.runs.map(r=>'<div class="bar"><span>'+esc(r.summary.writer+' · '+r.summary.router.split(' ')[0])+'</span><span class="t"><span class="f" style="width:'+(100*(r.summary.costPerAnsweredUsd||0)/mc)+'%"></span></span><span class="v">'+usd(r.summary.costPerAnsweredUsd)+'</span></div>').join('')+'</div></div></div></div>'}
  if(D.toolcalling.length){const by={};for(const r of D.toolcalling){(by[r.model]??=[]).push(r)}
    h+='<h2>Tool-calling eval</h2><div class="panel tbl"><table><thead><tr><th>Model</th><th>Cases passed</th><th>Tool calls</th><th>Failed calls</th></tr></thead><tbody>'+Object.entries(by).map(([m,rs])=>{const calls=rs.flatMap(r=>r.called||[]);return '<tr><td>'+esc(m)+'</td><td class="num">'+rs.filter(r=>r.ok).length+'/'+rs.length+'</td><td class="num">'+calls.length+'</td><td class="num">'+calls.filter(c=>!c.ok).length+'</td></tr>'}).join('')+'</tbody></table></div>'}
  el.innerHTML=h;el.querySelectorAll('[data-run]').forEach(b=>b.onclick=()=>{show('evals');selectRun(b.dataset.run)});
})();

// ---------------- traces
let cur=null;
(function(){
  const el=$('#tab-traces');
  el.innerHTML='<div class="split"><div class="panel"><div class="filters"><select id="f-set"><option value="">All sources</option>'+D.traceSets.map(s=>'<option value="'+esc(s.key)+'">'+esc(s.label)+' ('+s.traces.length+')</option>').join('')+'</select><select id="f-route"><option value="">Any route</option><option>answer</option><option>handoff</option><option>clarify</option></select><select id="f-res"><option value="">Any result</option><option value="fail">Eval failures</option><option value="fallback">Writer fallback</option><option value="repaired">Repaired</option></select><input type="search" id="f-q" placeholder="Search message, reply, rule…"></div><div class="list" id="list"></div></div><div class="panel" id="detail"><div class="empty">Select a trace</div></div></div>';
  ['f-set','f-route','f-res','f-q'].forEach(id=>$('#'+id).addEventListener('input',renderList));renderList();
})();
function renderList(){
  const set=$('#f-set').value,route=$('#f-route').value,res=$('#f-res').value,q=$('#f-q').value.toLowerCase();
  const items=allTraces.filter(t=>(!set||t._set===set)&&(!route||t.route===route)&&(!res||(res==='fail'?rowFor(t._set,t.id)?.pass===false:t.writer?.outcome===res))&&(!q||JSON.stringify([t.message,t.reply?.response,t.rulesFired,t.skills?.loaded]).toLowerCase().includes(q)));
  $('#list').innerHTML=items.length?items.map((t,i)=>{const row=rowFor(t._set,t.id);return '<div class="item" data-i="'+allTraces.indexOf(t)+'"><div class="msg">'+esc(t.message)+'</div><div class="meta">'+routeChip(t)+(row?(row.pass?'<span class="chip ok">pass</span>':'<span class="chip bad">fail</span>'):'')+'<span>'+ms(t.latencyMs)+'</span><span>'+usd(t.usage?.costUsd)+'</span><span style="margin-left:auto">'+esc(String(t.id))+'</span></div></div>'}).join(''):'<div class="empty">No traces match</div>';
  $('#list').querySelectorAll('.item').forEach(n=>n.onclick=()=>openTrace(+n.dataset.i));
}
function routeChip(t){return t.route==='handoff'?'<span class="chip warn">handoff'+(t.category?' · '+esc(t.category):'')+'</span>':t.route==='clarify'?'<span class="chip acc">clarify</span>':'<span class="chip">answer'+(t.writer?.outcome&&t.writer.outcome!=='ok'?' · '+esc(t.writer.outcome):'')+'</span>'}
function openTrace(i){
  cur=i;document.querySelectorAll('.item').forEach(n=>n.setAttribute('aria-current',+n.dataset.i===i));
  const t=allTraces[i];const row=rowFor(t._set,t.id);const T0=t.startedAt||0;const total=Math.max(1,t.latencyMs||1);
  const rows=[];const add=(name,kind,start,end,sub)=>{if(start==null)return;rows.push({name,kind,start,end:Math.max(end??start,start),sub})};
  const K={guards:'guard',router:'router',gate:'guard',skills:'step',evidence:'step',writer:'step','output-battery':'eval',commit:'commit'};
  for(const s of t.timeline||[])add(s.step,K[s.step]||'step',s.start,s.end);
  for(const tl of t.tools||[])add('tool · '+tl.tool,tl.origin==='commit'?'commit':'tool',tl.at,tl.at+(tl.ms||0),tl.origin+(tl.ok?'':' · failed'));
  for(const a of t.writer?.attempts||[])add('llm · '+a.phase,'llm',a.startedAt,a.startedAt+a.latencyMs,a.model);
  rows.sort((a,b)=>a.start-b.start);
  const wf=rows.length&&T0?rows.map(r=>'<div class="wf-row"><div class="wf-name" title="'+esc(r.name+(r.sub?' ('+r.sub+')':''))+'"><b>'+esc(r.name)+'</b>'+(r.sub?' <span>'+esc(r.sub)+'</span>':'')+'</div><div class="wf-track"><div class="wf-bar k-'+r.kind+'" style="left:'+Math.min(99.5,100*(r.start-T0)/total)+'%;width:'+Math.max(.4,100*(r.end-r.start)/total)+'%"></div></div><div class="wf-dur">'+ms(r.end-r.start)+'</div></div>').join(''):'<div class="muted">No timing data in this trace (older format).</div>';
  const sig=t.router?.signals||{};const pb=(label,p,hi)=>'<div class="bar"><span>'+esc(label)+'</span><span class="t"><span class="f'+(hi&&p>=.6?' hi':'')+'" style="width:'+(100*p)+'%"></span></span><span class="v">'+(p*100).toFixed(0)+'%</span></div>';
  const cp=s=>{const [c,p]=String(s||'').split(':');return{c,p:parseFloat(p)||0}};
  const ua=cp(sig.unsupportedAction),pm=cp(sig.paymentMode);
  let routerH=t.router?('<div class="bars">'+pb('needs human',sig.needsHuman||0,true)+pb('action: '+ua.c,ua.c==='none'?0:ua.p,true)+pb('medical urgent',sig.medicalUrgent||0,true)+pb('prompt injection',sig.promptInjection||0,true)+pb('pausing',sig.pausing||0)+pb('high engagement',sig.highEngagement||0)+'</div><div style="margin-top:10px">'+['payment: '+pm.c,'clinic: '+(sig.clinicMentioned||'–'),'lean: '+(sig.clinicLean||'–'),'package: '+(sig.packageLean||'–')].map(x=>'<span class="chip">'+esc(x)+'</span>').join('')+'</div><h4 style="margin-top:12px">Skill probabilities</h4><div class="bars">'+Object.entries(sig.skills||{}).sort((a,b)=>b[1]-a[1]).map(([k,p])=>pb(k,p)).join('')+'</div><div class="muted" style="margin-top:8px;font-size:12px">'+esc(t.router.adapter)+(t.router.secondOpinion?.length?' · second opinion: '+esc(t.router.secondOpinion.join(', '))+' · action consensus: '+esc(t.router.actionConsensus):'')+(t.router.chunks>1?' · routed in '+t.router.chunks+' chunks':'')+(Object.keys(t.router.merged||{}).length?' · merged (max): '+esc(Object.entries(t.router.merged).map(([k,v])=>k+' '+v.primary+'/'+v.secondary+'→'+v.merged).join('; ')):'')+(t.router.errors?.length?' · errors: '+esc(t.router.errors.join('; ')):'')+'</div>'):'<div class="muted">Handled before the router (human fast path).</div>';
  const skills=t.skills?('<div>'+t.skills.loaded.map(s=>'<span class="chip acc">'+esc(s)+' v'+esc(t.skills.versions?.[s])+' · '+esc(t.skills.selectedBy?.[s])+'</span>').join('')+(t.skills.suppressed||[]).map(s=>'<span class="chip warn">'+esc(s.id)+' suppressed by '+esc(s.by)+'</span>').join('')+'</div><div class="muted" style="font-size:12px;margin-top:6px">writer prompt ≈ '+esc(t.prompt?.approxTokens)+' tokens · '+esc(t.facts??0)+' facts in ledger</div>'):'<div class="muted">No skills loaded (handoff or clarify).</div>';
  const tools=(t.tools||[]).length?'<div class="tbl"><table><thead><tr><th>Tool</th><th>Origin</th><th>Args</th><th>Result</th></tr></thead><tbody>'+t.tools.map(x=>'<tr><td>'+esc(x.tool)+(x.ok?'':' <span class="chip bad">'+esc(x.error||'failed')+'</span>')+'</td><td><span class="chip">'+esc(x.origin)+'</span></td><td><code>'+esc(JSON.stringify(x.args))+'</code></td><td>'+(x.result?'<details><summary>'+esc(x.result.slice(0,60))+'…</summary><div><pre>'+esc(pretty(x.result))+'</pre></div></details>':'')+'</td></tr>').join('')+'</tbody></table></div>':'<div class="muted">No tool calls.</div>';
  const attempts=(t.writer?.attempts||[]).map(a=>{const v=a.violations||[];return '<details'+(v.some(x=>x.severity==='hard')?' open':'')+'><summary><b>'+esc(a.phase)+'</b> <span class="chip">'+esc(a.model)+'</span><span class="chip">'+esc(a.usage?.inputTokens)+' in / '+esc(a.usage?.outputTokens)+' out</span><span class="chip">'+ms(a.latencyMs)+'</span><span class="chip">'+usd(a.usage?.costUsd)+'</span>'+v.map(x=>'<span class="chip '+(x.severity==='hard'?'bad':'warn')+'" title="'+esc(x.detail)+'">'+esc(x.code)+'</span>').join('')+(a.toolCalls||[]).map(c=>'<span class="chip '+(c.ok?'ok':'bad')+'">'+esc(c.name)+'</span>').join('')+'</summary><div>'+(v.length?'<ul style="margin:0 0 8px;padding-left:18px">'+v.map(x=>'<li><b>'+esc(x.code)+'</b> '+esc(x.detail)+'</li>').join('')+'</ul>':'')+'<pre>'+esc(pretty(a.output||''))+'</pre></div></details>'}).join('');
  const claims=(t.writer?.claims||[]).length?'<ul style="margin:0;padding-left:18px">'+t.writer.claims.map(c=>'<li>'+esc(c.text)+' '+(c.sources||[]).map(s=>'<span class="chip">'+esc(s)+'</span>').join('')+'</li>').join('')+'</ul>':'';
  const ob=t.outputBattery&&!t.outputBattery.error?'<div class="bars">'+Object.entries(t.outputBattery).map(([k,p])=>pb(k.replace(/_/g,' '),p,true)).join('')+'</div>':'<div class="muted">Not run.</div>';
  const commits=(t.commits||[]).length||(t.commitSkipped||[]).length?(t.commits||[]).map(c=>'<div><span class="chip '+(c.ok?'ok':'bad')+'">'+esc(c.tool)+'</span> <code>'+esc(JSON.stringify(c.args))+'</code></div>').join('')+(t.commitSkipped||[]).map(s=>'<div class="muted">skipped: '+esc(s)+'</div>').join(''):'<div class="muted">No writes.</div>';
  const r=t.reply||{};
  $('#detail').innerHTML='<div class="detail"><div class="dh"><h3>'+esc(t.id)+'</h3>'+routeChip(t)+(row?(row.pass?'<span class="chip ok">eval pass</span>':'<span class="chip bad">eval fail</span>'):'')+'<span class="chip">'+ms(t.latencyMs)+'</span><span class="chip">'+usd(t.usage?.costUsd)+'</span><span class="chip">'+esc(t.usage?.inputTokens??0)+' in / '+esc(t.usage?.outputTokens??0)+' out tokens</span>'+(t.writer?.providerFailover?'<span class="chip warn">failover</span>':'')+(t.error?'<span class="chip bad">error</span>':'')+'<span class="muted" style="font-size:12px">'+esc(t._label)+'</span></div>'+
  (row&&!row.pass?'<div class="sec"><h4>Failed checks</h4>'+row.failed.map(f=>'<span class="chip bad">'+esc(f)+'</span>').join('')+'</div>':'')+
  '<div class="cols"><div class="sec"><h4>Patient</h4><div class="in">'+esc(t.message)+'</div></div><div class="sec"><h4>Reply'+(r.escalate?' · escalated':'')+'</h4><div class="sms'+(r.escalate?' esc':'')+'">'+esc(r.response)+'</div><div style="margin-top:8px">'+(r.escalate?'<span class="chip warn">'+esc(r.escalationReason)+'</span>':'')+'<span class="chip">intent: '+esc(r.intent)+'</span>'+(r.shouldFollowUp?'<span class="chip acc">follow up '+esc(r.followUpTiming)+'</span>':'')+(r.highEngagement?'<span class="chip acc">high engagement</span>':'')+((r.attachmentUrls||[]).length?'<span class="chip">'+r.attachmentUrls.length+' attachments</span>':'')+'</div></div></div>'+
  '<div class="sec"><h4>Timeline</h4><div class="wf">'+wf+'</div><div class="legend"><span><i class="k-guard"></i>guard / gate</span><span><i class="k-router"></i>router</span><span><i class="k-tool"></i>tool</span><span><i class="k-llm"></i>LLM</span><span><i class="k-eval"></i>output battery</span><span><i class="k-commit"></i>writes</span><span><i class="k-step"></i>step</span></div></div>'+
  '<div class="cols"><div class="sec"><h4>Router decision</h4>'+routerH+'</div><div class="sec"><h4>Policy gate</h4><div>'+(t.rulesFired||[]).map(x=>'<span class="chip '+(/unsupported|human|safety|abuse|card/.test(x)?'warn':'')+'">'+esc(x)+'</span>').join('')+'</div><h4 style="margin-top:16px">Skills</h4>'+skills+'<h4 style="margin-top:16px">Output battery (signal only)</h4>'+ob+'</div></div>'+
  '<div class="sec"><h4>Tools</h4>'+tools+'</div>'+
  (attempts?'<div class="sec"><h4>Writer attempts · outcome: '+esc(t.writer?.outcome)+(t.writer?.providerFailover?' · '+esc(t.writer.providerFailover):'')+'</h4><div style="display:grid;gap:8px">'+attempts+'</div></div>':'')+
  (claims?'<div class="sec"><h4>Claims and sources</h4>'+claims+'</div>':'')+
  ((t.usageByStage||[]).length?'<div class="sec"><h4>Cost by stage'+(t.usage?.costComplete===false?' · incomplete (unknown costs)':'')+(t.usage?.costEstimated?' · includes estimates':'')+'</h4><div class="tbl"><table><thead><tr><th>Stage</th><th>Input tok</th><th>Output tok</th><th>Cost</th></tr></thead><tbody>'+t.usageByStage.map(u=>'<tr><td>'+esc(u.stage)+'</td><td class="num">'+(u.inputTokens??'?')+'</td><td class="num">'+(u.outputTokens??'?')+'</td><td class="num">'+(u.costUsd==null?'<span class="chip warn">unknown</span>':usd(u.costUsd)+(u.estimated?' <span class="chip">est.</span>':''))+'</td></tr>').join('')+'</tbody></table></div></div>':'')+
  '<div class="cols"><div class="sec"><h4>Writes</h4>'+commits+'</div><div class="sec"><h4>Reply JSON</h4><pre>'+esc(JSON.stringify(r,null,2))+'</pre></div></div>'+
  (t.prompt?.system?'<details><summary>Exact prompt the writer saw ('+esc(t.prompt.approxTokens)+' tokens)</summary><div><pre>'+esc(t.prompt.system)+'\n\n--- user ---\n'+esc(t.prompt.user||'')+'</pre></div></details>':'')+
  '</div>';
}
function pretty(s){try{return JSON.stringify(JSON.parse(s),null,2)}catch(e){return s}}

// ---------------- eval runs
function selectRun(key){$('#e-run').value=key;renderRun()}
(function(){
  const el=$('#tab-evals');
  if(!D.runs.length){el.innerHTML='<div class="panel empty">No eval runs found in eval/results.</div>';return}
  el.innerHTML='<div class="panel" style="padding:12px;display:flex;gap:10px;align-items:center"><label for="e-run" class="muted">Run</label><select id="e-run">'+D.runs.map(r=>'<option value="'+esc(r.key)+'">'+esc(r.label)+'</option>').join('')+'</select></div><div id="e-body"></div>';
  $('#e-run').oninput=renderRun;renderRun();
})();
function renderRun(){
  const run=D.runs.find(r=>r.key===$('#e-run').value);const s=run.summary;const byCase={};
  for(const r of run.rows)(byCase[r.id]??=[]).push(r);
  const ids=Object.keys(byCase);const k=s.k||1;
  let h='<h2>Summary</h2><div class="tiles">'+[[s.passRate,'pass rate'],[s.passK,'pass^'+k],[s.escalationRecall,'escalation recall'],[s.escalationPrecision,'escalation precision'],[s.falseEscalations,'false escalations'],[ms(s.latencyP95ms),'latency p95']].map(([v,l])=>'<div class="panel tile"><b>'+esc(v)+'</b><span>'+esc(l)+'</span></div>').join('')+'</div>';
  h+='<h2>Case × run</h2><div class="panel" style="padding:14px;overflow:auto"><div class="grid" style="--n:'+k+'">'+ids.map(id=>'<div class="lbl" title="'+esc(id)+'">'+esc(id)+'</div>'+Array.from({length:k},(_,i)=>{const r=byCase[id].find(x=>x.run===i);return '<button class="cell '+(r?(r.pass?'p':'f'):'n')+'" title="'+esc(id+' run '+i+(r&&!r.pass?': '+r.failed.join('; '):''))+'" data-case="'+esc(id)+'" data-run="'+i+'" style="border:0;cursor:pointer"></button>'}).join('')).join('')+'</div></div>';
  const fails=run.rows.filter(r=>!r.pass);
  h+='<h2>Failures ('+fails.length+')</h2>'+(fails.length?'<div class="panel tbl"><table><thead><tr><th>Case</th><th>Route</th><th>Failed checks</th><th>Reply</th></tr></thead><tbody>'+fails.map(f=>'<tr><td><button class="link" data-case="'+esc(f.id)+'" data-run="'+f.run+'">'+esc(f.id)+'#'+f.run+'</button></td><td>'+esc(f.route)+'</td><td>'+f.failed.map(x=>'<span class="chip bad">'+esc(x)+'</span>').join('')+'</td><td class="muted">'+esc(String(f.response).slice(0,180))+'</td></tr>').join('')+'</tbody></table></div>':'<div class="panel empty">No failures in this run.</div>');
  $('#e-body').innerHTML=h;
  $('#e-body').querySelectorAll('[data-case]').forEach(b=>b.onclick=()=>{const i=allTraces.findIndex(t=>t._set===run.key&&t.id===b.dataset.case+'#'+b.dataset.run);if(i<0){alert?.('No trace saved for this run');return}show('traces');$('#f-set').value=run.key;renderList();openTrace(i)});
}
const fromHash=()=>{const h0=(location.hash||'').slice(1);if(['overview','traces','evals'].includes(h0))show(h0)};fromHash();window.addEventListener('hashchange',fromHash);
</script></body></html>`;
}
