'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const S = require('../app/web/dist/session.js');
const row = (question='CCD 检出基膜油斑') => ({question,report:'实物能对应吗？\nA．能\nB．尚未检查',question_key:'physical',
  options:[{value:'A',label:'能'},{value:'B',label:'尚未检查'}],mode:'offline',
  context:{activation:{article_ids:['atlas_oil'],node_ids:['base_oilspot'],edge_ids:[]},messages:[{content:'not for export'}]},
  sources:[{id:'ext_demo',title:'参考',url:'https://example.org/study',excerpt:'待核验摘录',anchor_ids:['base_oilspot']}],
  settings:{api_key:'synthetic-secret'},api_key:'synthetic-secret'});

test('round trip retains answers, options, draft and references; drops credentials and prompts',()=>{
  const s=S.create([row(),row('B')],{text:'用户尚未检查，不能据此排除。',through:0},'准备补充的新观察');
  const raw=JSON.stringify({...s,settings:{api_key:'synthetic-secret'}});
  const restored=S.parse(raw), clean=JSON.stringify(restored);
  assert.equal(restored.turns[1].question,'B');assert.equal(restored.turns[0].options[1].label,'尚未检查');
  assert.equal(restored.draft,'准备补充的新观察');assert.equal(restored.handoff.text,s.handoff.text);
  assert(!clean.includes('synthetic-secret'));assert(!clean.includes('not for export'));
  assert.equal(restored.turns[0].sources[0].status,'历史摘录 · 待核验');
  assert(S.markdown(restored).includes('交接记录'));assert(S.markdown(restored).includes('未发送的草稿'));
});
test('long conversation keeps full archive while continuation uses checked handoff and last pending question',()=>{
  const turns=Array.from({length:80},(_,i)=>row(i?'补充'+i:'最初的油斑问题'));
  const full=S.create(turns,{text:'详细记录：多个候选仍待验证。',through:79});
  const resumed=S.input(S.parse(JSON.stringify(full)));
  assert.equal(full.turns.length,80);assert.equal(resumed.history.length,1);
  assert.equal(resumed.history[0].report,turns[79].report);
  assert.equal(resumed.handoff.initial_issue,'最初的油斑问题');assert.equal(resumed.handoff.archived_turns,79);
  const atLimit=S.create(turns.slice(0,50));assert.throws(()=>S.input(atLimit));
  assert.equal(S.input(atLimit,true).history.length,50);
});
test('reject malformed, unsupported, unsafe and excessive imports without mutating current state',()=>{
  const current=S.create([row()]), before=JSON.stringify(current);
  for(const value of ['bad',JSON.stringify({messages:[]}),JSON.stringify({...current,version:99}),
    JSON.stringify({...current,handoff:{text:'',through:1}}),JSON.stringify({...current,turns:[row('x'.repeat(12001))]})]) {
    assert.throws(()=>S.parse(value));assert.equal(JSON.stringify(current),before);
  }
  const hostile=row();hostile.sources[0].url='javascript:alert(1)';assert.throws(()=>S.create([hostile]));
  assert.throws(()=>S.parse(' '.repeat(S.MAX_BYTES+1)));
  assert.throws(()=>S.create(Array.from({length:501},()=>row())));
});
test('early length boundary leaves room to generate a detailed handoff without dropping history',()=>{
  const turns=Array.from({length:8},()=>({...row(),report:'未验证。'.repeat(2000)}));
  const s=S.create(turns);assert.throws(()=>S.input(s));assert.equal(S.input(s,true).history.length,8);
  assert.equal(S.parse('\uFEFF'+JSON.stringify(s)).turns.length,8);
});

const ledger = () => ({version:1,initial_issue:'CCD 检出基膜油斑',turn:2,
  facts:[{id:'f1',turn:1,text:'固定间距重复',answer:'固定间距重复',prompt:'',status:'superseded',superseded_by:'f2',source:'user'},
    {id:'f2',turn:2,text:'更正，间距不固定',answer:'更正，间距不固定',prompt:'',status:'reported',source:'user'}],
  hypotheses:[{id:'contact',text:'接触转移仍待验证',support:[],against:['f2'],status:'weakened'}],
  checks:[{text:'用户重新核对间距',fact_ids:['f2'],status:'user_reported'}],open_questions:['是否有实物对应？'],
  retrieval_history:[{turn:2,queries:['间距不固定'],article_ids:['atlas_oil'],edge_ids:[]}],
  pending:{question:'实物能对应吗？',options:[{value:'A',label:'能'},{value:'B',label:'尚未检查'}]},settings:{api_key:'DROP_ME'}});
test('ledger corrections, candidates and exact evidence survive handoff without duplicating state per turn',()=>{
  const latest=row('更正，间距不固定');latest.context.retrieved=[{id:'atlas_oil:1',article_id:'atlas_oil',title:'油斑路径',heading:'分布检查',text:'条件性机理片段',reason:'沿关联核对分布',retrieval_kind:'graph'}];
  latest.context.retrieval_trace=[{kind:'search',query:'间距不固定',reason:'最新更正',hop:0,article_ids:['atlas_oil'],edge_ids:[],node_ids:['base_oilspot']}];
  const saved=S.create([row(),latest],{text:'已更正间距说法，原因仍待验证。',through:1},'',ledger());
  const restored=S.parse(JSON.stringify(saved)), input=S.input(restored);
  assert.equal(input.history.length,1);assert.equal(input.analysis_state.facts[0].status,'superseded');
  assert.equal(input.analysis_state.hypotheses[0].status,'weakened');assert.equal(input.history[0].options[1].label,'尚未检查');
  assert.equal(restored.turns[1].context.retrieved[0].text,'条件性机理片段');
  assert(!JSON.stringify(restored).includes('DROP_ME'));assert(!('analysis_state' in restored.turns[0]));
  assert(S.markdown(restored).includes('已更正'));assert(S.markdown(restored).includes('接触转移仍待验证'));
});
test('import rejects mismatched ledger, nonexistent citations and invented confirmed cause',()=>{
  const turns=[row(),row('补充')];
  for(const mutate of [s=>s.turn=1,s=>s.initial_issue='另一个问题',s=>s.facts[0].superseded_by='fake',
      s=>s.hypotheses[0].status='confirmed',s=>s.hypotheses[0].support=['fake'],s=>s.facts[1].id='f1']){
    const state=ledger();mutate(state);assert.throws(()=>S.create(turns,{text:'',through:0},'',state));
  }
  const invalid=row();invalid.context.retrieved=[{id:'x:1',article_id:'not-activated',text:'未提供的资料'}];
  assert.throws(()=>S.create([invalid]));
  // Earlier files lack the ledger and snippets and remain readable.
  assert.equal(S.parse(JSON.stringify(S.create([row()]))).analysis_state,null);
});
