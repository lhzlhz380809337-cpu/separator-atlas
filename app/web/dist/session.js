'use strict';
// Portable conversation records. Only allowlisted fields cross the file boundary.
((root) => {
  const FORMAT = 'separator-atlas-session', VERSION = 1, MAX_BYTES = 5 * 1024 * 1024;
  function fail(message) { throw new Error(message); }
  function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
  function text(value, max, field, required = false) {
    if (value === undefined || value === null) value = '';
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(`${field}为空、过长或格式不正确。`);
    return value;
  }
  function list(value, max, field) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > max) fail(`${field}格式不正确或超出上限。`);
    return value;
  }
  const ids = value => list(value, 100, '知识标识').map(v => text(v, 200, '知识标识', true));
  function analysisState(value) {
    if (value === undefined || value === null) return null;
    if (!object(value) || value.version !== 1 || !Number.isInteger(value.turn) || value.turn < 0 || value.turn > 500) fail('分析进度版本或轮次不正确。');
    const facts = list(value.facts,500,'现场陈述').map(f => {
      if (!object(f) || !['reported','unknown','superseded','disputed'].includes(f.status) || !Number.isInteger(f.turn) || f.turn < 1 || f.turn > value.turn) fail('现场陈述的状态或轮次不正确。');
      const clean={id:text(f.id,200,'陈述标识',true),turn:f.turn,text:text(f.text,14000,'现场陈述',true),prompt:text(f.prompt,2000,'对应问题'),answer:text(f.answer,12000,'原始回答'),status:f.status,source:'user'};
      if(f.superseded_by)clean.superseded_by=text(f.superseded_by,200,'更正标识',true);
      return clean;
    });
    const known = new Set(facts.map(f=>f.id));
    if(known.size!==facts.length || facts.some(f=>f.superseded_by && (!known.has(f.superseded_by)||f.superseded_by===f.id)))fail('现场陈述标识重复或更正引用不存在。');
    const refs = value => {
      const result=list(value,30,'陈述引用').map(x=>text(x,200,'陈述标识',true));
      if(result.some(x=>!known.has(x)))fail('分析进度引用了不存在的现场陈述。');
      return result;
    };
    const clean={version:1,initial_issue:text(value.initial_issue,12000,'初始问题',true),turn:value.turn,facts,
      hypotheses:list(value.hypotheses,12,'候选原因').map(h=>{
        if(!object(h)||!['candidate','weakened'].includes(h.status))fail('候选原因不能标记为已确认根因。');
        return {id:text(h.id,80,'候选标识',true),text:text(h.text,1500,'候选原因',true),support:refs(h.support),against:refs(h.against),status:h.status};
      }),
      checks:list(value.checks,30,'检查记录').map(c=>{
        if(!object(c))fail('检查记录格式不正确。');
        const fact_ids=refs(c.fact_ids);if(!fact_ids.length)fail('检查结果缺少用户陈述来源。');
        return {text:text(c.text,2000,'检查记录',true),fact_ids,status:'user_reported'};
      }),
      open_questions:list(value.open_questions,12,'未决问题').map(q=>text(q,1000,'未决问题',true)),
      retrieval_history:list(value.retrieval_history,500,'检索记录').map(r=>{
        if(!object(r)||!Number.isInteger(r.turn)||r.turn<0||r.turn>value.turn)fail('检索记录轮次不正确。');
        return {turn:r.turn,queries:list(r.queries,3,'检索词').map(q=>text(q,2000,'检索词',true)),article_ids:ids(r.article_ids),edge_ids:ids(r.edge_ids)};
      }),
      pending:{question:text(value.pending?.question,2000,'待答问题'),options:options(value.pending?.options)}};
    if(JSON.stringify(clean).length>250000)fail('结构化分析进度较大，请保存完整记录后，为新的调查阶段建立对话。');
    return clean;
  }
  function options(value) {
    const result=list(value,10,'选项').map(o=>{
      if(!object(o))fail('选项格式不正确。');
      return {value:text(o.value,10,'选项编号',true),label:text(o.label,1000,'选项文字',true)};
    });
    if(new Set(result.map(o=>o.value.toUpperCase())).size!==result.length)fail('选项编号重复。');
    return result;
  }
  function evidence(value) {
    const v=value||{}, a=v.activation||{};
    const activation={article_ids:ids(a.article_ids),node_ids:ids(a.node_ids),edge_ids:ids(a.edge_ids),graph_node_ids:ids(a.graph_node_ids),graph_edge_ids:ids(a.graph_edge_ids)};
    return {activation,
      retrieved:list(v.retrieved,24,'知识片段').map(c=>{
        if(!object(c)||!activation.article_ids.includes(c.article_id))fail('知识片段与本轮点亮记录不对应。');
        return {id:text(c.id,200,'片段标识',true),article_id:text(c.article_id,200,'条目标识',true),title:text(c.title,1000,'知识标题'),heading:text(c.heading,1000,'片段标题'),text:text(c.text,2000,'知识片段',true),reason:text(c.reason,2000,'查阅理由'),retrieval_kind:['search','graph','supplement'].includes(c.retrieval_kind)?c.retrieval_kind:'search'};
      }),
      related_edges:list(v.related_edges,16,'查阅关系').filter(e=>activation.edge_ids.includes(e?.id)).map(e=>({
        id:text(e.id,200,'关系标识',true),source:text(e.source,200,'起点',true),target:text(e.target,200,'终点',true),source_label:text(e.source_label,1000,'起点名称'),target_label:text(e.target_label,1000,'终点名称'),
        mechanism:text(e.mechanism,6000,'关系机理'),conditions:list(e.conditions,30,'适用条件').map(x=>text(x,2000,'适用条件')),checks:list(e.checks,30,'核查方法').map(x=>text(x,2000,'核查方法')),article_ids:ids(e.article_ids),reason:text(e.reason,2000,'查阅理由')})),
      retrieval_trace:list(v.retrieval_trace,30,'查阅路径').map(r=>{
        if(!object(r)||!['search','graph','supplement'].includes(r.kind)||!Number.isInteger(r.hop)||r.hop<0||r.hop>2)fail('查阅路径格式不正确。');
        return {kind:r.kind,query:text(r.query,2000,'检索词'),reason:text(r.reason,2000,'查阅理由'),article_ids:ids(r.article_ids).filter(x=>activation.article_ids.includes(x)),edge_ids:ids(r.edge_ids).filter(x=>activation.edge_ids.includes(x)),node_ids:ids(r.node_ids).filter(x=>activation.node_ids.includes(x)),hop:r.hop,from_node_id:text(r.from_node_id,200,'关联起点')};
      }),retrieval_gaps:list(v.retrieval_gaps,100,'知识缺口').map(g=>text(g,2000,'知识缺口'))};
  }
  function source(value) {
    if (!object(value)) fail('外部参考格式不正确。');
    let url;
    try { url = new URL(text(value.url, 3000, '参考网址', true)); } catch { fail('外部参考网址无效。'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) fail('外部参考只允许不含账号的 HTTP(S) 网址。');
    const id = text(value.id, 200, '参考标识', true);
    if (!id.startsWith('ext_')) fail('外部参考标识格式不正确。');
    return {id, url:url.href, title:text(value.title, 1000, '参考标题'), excerpt:text(value.excerpt, 12000, '参考摘录'),
      retrieved_at:text(value.retrieved_at, 100, '检索时间'), status:'历史摘录 · 待核验', anchor_ids:ids(value.anchor_ids)};
  }
  function turn(value) {
    if (!object(value)) fail('问答记录格式不正确。');
    return {question:text(value.question, 12000, '问题', true), report:text(value.report, 16000, '回答', true),
      question_key:text(value.question_key, 100, '问题标识'), mode:value.mode === 'model' ? 'model' : 'offline',
      phase:text(value.phase, 150, '分析阶段'),
      options:options(value.options),
      sources:list(value.sources, 5, '外部参考').map(source), external_used:ids(value.external_used),
      warnings:list(value.warnings, 20, '提示').map(w => text(w, 2000, '提示')),
      context:evidence(value.context)};
  }
  function normalize(value) {
    if (!object(value) || value.format !== FORMAT) fail('请选择“保存进度”生成的 JSON 文件。Markdown 对话和模型材料包不能直接载入。');
    if (value.version !== VERSION) fail('此进度文件版本暂不支持，请使用兼容版本的工作台。');
    const turns = list(value.turns, 500, '完整问答').map(turn);
    if (!turns.length) fail('进度文件没有问答记录。');
    const handoff = value.handoff || {text:'', through:0};
    if (!object(handoff) || !Number.isInteger(handoff.through) || handoff.through < 0 || handoff.through >= turns.length) fail('交接记录的覆盖轮次不正确。');
    const notes = text(handoff.text, 16000, '交接记录');
    if (handoff.through && !notes.trim()) fail('分段进度缺少交接记录，不能丢弃前面的问答。');
    const clean = {format:FORMAT, version:VERSION, title:text(value.title, 160, '分析标题') || turns[0].question.slice(0,80),
      saved_at:text(value.saved_at, 100, '保存时间'), turns, handoff:{text:notes,through:handoff.through},
      draft:text(value.draft, 6000, '未发送草稿'),analysis_state:analysisState(value.analysis_state)};
    if(clean.analysis_state && (clean.analysis_state.turn!==turns.length || clean.analysis_state.initial_issue!==turns[0].question))fail('分析进度与问答轮次或初始问题不对应。');
    if (new TextEncoder().encode(JSON.stringify(clean)).length > MAX_BYTES) fail('进度内容超过 5 MB，请分开保存不同问题。');
    return clean;
  }
  function create(turns, handoff = {text:'',through:0}, draft = '', analysis_state = null) {
    return normalize({format:FORMAT, version:VERSION, title:turns[0]?.question.slice(0,80), saved_at:new Date().toISOString(), turns, handoff, draft,analysis_state});
  }
  function parse(raw) {
    if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > MAX_BYTES) fail('请选择不超过 5 MB 的进度文件。');
    let parsed;
    try { parsed = JSON.parse(raw.replace(/^\uFEFF/, '')); } catch { fail('无法读取 JSON 文件，当前对话没有被替换。'); }
    return normalize(parsed);
  }
  function input(session, forHandoff = false) {
    const clean = normalize(session), active = clean.turns.slice(clean.handoff.through);
    const size = active.reduce((n,t) => n + t.question.length + t.report.length, 0);
    if (active.length > 50 || (!forHandoff && active.length >= 50) || size > (forHandoff ? 85000 : 60000)) fail('本段对话较长，请在“保存进度”中整理并核对交接记录，再勾选采用后继续。完整问答仍保留。');
    return {history:active.map(t => ({question:t.question,report:t.report,question_key:t.question_key,options:t.options})),analysis_state:clean.analysis_state,
      handoff:{initial_issue:clean.turns[0].question, notes:clean.handoff.text, archived_turns:clean.handoff.through}};
  }
  function markdown(session) {
    const s = normalize(session);
    return '# 隔膜问题分析记录\n\n'+s.title+'\n\n保存时间：'+s.saved_at+'\n\n'+
      '用户陈述、模型候选及现场验证应分别核查。外部来源为历史摘录，未自动重新核验。\n\n'+
      (s.handoff.text ? '## 交接记录（待接手人核对）\n\n'+s.handoff.text+'\n\n' : '')+
      (s.analysis_state ? '## 分析进度（用户陈述与候选，需核对）\n\n'+
        s.analysis_state.facts.map(f=>`- 第 ${f.turn} 轮 · ${{reported:'用户陈述',unknown:'未知或未检查',superseded:'已更正',disputed:'存在冲突'}[f.status]}：${f.text}`).join('\n')+'\n\n'+
        s.analysis_state.hypotheses.map(h=>`- 候选：${h.text}；支持陈述：${h.support.join('、')||'未提供'}；反对陈述：${h.against.join('、')||'未提供'}`).join('\n')+'\n\n'+
        s.analysis_state.checks.map(c=>`- 用户报告的检查：${c.text}`).join('\n')+'\n\n'+
        s.analysis_state.open_questions.map(q=>'- 未决：'+q).join('\n')+'\n\n' : '')+
      s.turns.map((t,i) => `## 第 ${i+1} 轮 · 用户\n\n${t.question}\n\n### 助手\n\n${t.report}\n\n`+
        t.sources.map(x => `外部参考：[${x.title}](${x.url}) · 历史摘录，待核验`).join('\n')).join('\n\n---\n\n')+
      (s.draft ? '\n\n## 未发送的草稿\n\n'+s.draft : '');
  }
  const api = {FORMAT, VERSION, MAX_BYTES, normalize, create, parse, input, markdown,analysisState,evidence};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SeparatorSession = api;
})(globalThis);
