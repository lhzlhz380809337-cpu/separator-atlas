'use strict';
const $ = id => document.getElementById(id);
const state = {token:'', articles:[], graph:{nodes:[],edges:[]}, playbooks:[], selectedNode:null, graphStage:'全部', report:'', packet:null, busy:false};
const captions = {home:'知识星图',graph:'关系探索',library:'知识阅读',settings:'模型与知识迁移'};
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let toastTimer;
function toast(text){$('toast').textContent=text;$('toast').style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').style.display='none',3500);}
async function api(path, payload){
  const options=payload === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':state.token},body:JSON.stringify(payload)};
  const response=await fetch(path,options);
  let data;try{data=await response.json();}catch{throw new Error('服务未返回有效内容，请检查本地工作台是否仍在运行。');}
  if(!response.ok)throw new Error(data.error||'操作失败。');return data;
}
function inlineMD(text){
  let s=escapeHTML(text);
  s=s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,(match,title,label)=>{const candidates=state.articles.filter(a=>a.title===title||a.id===title||(a.aliases||[]).includes(title));return candidates.length===1?`<button class="wiki-link" data-article="${escapeHTML(candidates[0].id)}">${label||title}</button>`:match;});
  s=s.replace(/`([^`]+)`/g,'<code>$1</code>');
  s=s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  s=s.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
  s=s.replace(/\*([^*\n]+)\*/g,'<em>$1</em>');
  return s;
}
function markdown(text){
  const lines=String(text||'').replace(/\r/g,'').split('\n');let out=[],i=0;
  while(i<lines.length){
    const line=lines[i];
    if(!line.trim()){i++;continue;}
    if(line.startsWith('```')){let block=[];i++;while(i<lines.length&&!lines[i].startsWith('```'))block.push(lines[i++]);i++;out.push('<pre><code>'+escapeHTML(block.join('\n'))+'</code></pre>');continue;}
    const heading=line.match(/^(#{1,4})\s+(.+)/);if(heading){const n=heading[1].length;out.push(`<h${n}>${inlineMD(heading[2])}</h${n}>`);i++;continue;}
    if(i+1<lines.length && line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[i+1])){
      const cells=s=>s.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim());const headers=cells(line);i+=2;let body=[];
      while(i<lines.length&&lines[i].includes('|')&&lines[i].trim())body.push(cells(lines[i++]));
      out.push('<div class="table-scroll"><table><thead><tr>'+headers.map(c=>'<th>'+inlineMD(c)+'</th>').join('')+'</tr></thead><tbody>'+body.map(row=>'<tr>'+row.map(c=>'<td>'+inlineMD(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>');continue;
    }
    if(/^\s*[-*]\s+/.test(line)||/^\s*\d+[.)、]\s*/.test(line)){
      const ordered=/^\s*\d+[.)、]/.test(line),tag=ordered?'ol':'ul',pattern=ordered?/^\s*\d+[.)、]\s*/:/^\s*[-*]\s+/;let items=[];
      while(i<lines.length&&pattern.test(lines[i]))items.push('<li>'+inlineMD(lines[i++].replace(pattern,''))+'</li>');
      out.push(`<${tag}>${items.join('')}</${tag}>`);continue;
    }
    if(line.startsWith('>')){let block=[];while(i<lines.length&&lines[i].startsWith('>'))block.push(inlineMD(lines[i++].replace(/^>\s?/,'')));out.push('<blockquote>'+block.join('<br>')+'</blockquote>');continue;}
    if(/^[-*_]{3,}$/.test(line.trim())){out.push('<hr>');i++;continue;}
    let paragraph=[inlineMD(line)];i++;
    while(i<lines.length&&lines[i].trim()&&!/^(#{1,4}\s|```|>|\s*[-*]\s|\s*\d+[.)、])/.test(lines[i])&&!(i+1<lines.length&&/^\s*\|?\s*:?-{3,}/.test(lines[i+1])))paragraph.push(inlineMD(lines[i++]));
    out.push('<p>'+paragraph.join('<br>')+'</p>');
  }
  return out.join('\n');
}
function download(name,text,type='text/plain;charset=utf-8'){
  const url=URL.createObjectURL(new Blob([text],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function switchView(view){
  if(view==='analysis'||!captions[view])view='home';
  document.body.classList.toggle('cosmos-view',view==='home');
  window.CosmicHome?.setVisible(view==='home');
  document.querySelectorAll('.view').forEach(el=>el.classList.toggle('active',el.id==='view-'+view));
  document.querySelectorAll('.nav').forEach(el=>el.classList.toggle('active',el.dataset.view===view));
  document.querySelectorAll('.cosmos-header [data-open-view]').forEach(el=>{el.classList.toggle('current',el.dataset.openView===view);el.setAttribute('aria-current',el.dataset.openView===view?'page':'false');});
  $('view-caption').textContent=captions[view];history.replaceState(null,'','#'+view);
  if(view==='library')searchKnowledge();if(view==='graph'){state.selectedNode=null;state.graphStage='全部';atlasZoom=1;$('node-search').value='';document.querySelectorAll('#graph-stages button').forEach(b=>b.classList.toggle('active',b.dataset.stage==='全部'));renderNodeList();renderGraph();}
  window.scrollTo({top:0,behavior:'smooth'});
}
function modelSettings(){return {protocol:$('protocol').value,base_url:$('base-url').value.trim(),model:$('model-name').value.trim(),api_key:$('api-key').value,use_saved_key:true};}
function applyConnection(config){const model=config.model||{};if(model.base_url){$('base-url').value=model.base_url;$('model-name').value=model.model;$('protocol').value=model.protocol;$('context-budget').value=String(model.context_chars||16000);$('allow-send').checked=model.allow_send===true;}$('key-note').textContent=config.has_saved_key?'密钥已加密保存在本机。留空沿用，填写新密钥后保存可更换。':'可保存本机加密密钥，也可使用启动环境提供。';$('delete-key').disabled=!config.has_saved_key;}
function showPacket(ctx){state.packet=ctx;$('packet-info').textContent=`本次分析材料共 ${ctx.total_prompt_chars.toLocaleString()} 字符，包含知识、对话及适用规则。`;$('packet-preview').textContent=ctx.messages.map(m=>`【${m.role}】\n${m.content}`).join('\n\n');$('context-dialog').showModal();}
async function openArticle(id){
  try{const a=await api('/api/article?id='+encodeURIComponent(id));$('reader-stage').textContent=a.stage+' / '+a.category;$('reader-title').textContent=a.title;$('reader-content').innerHTML=markdown(a.content);if(!$('reader-dialog').open)$('reader-dialog').showModal();$('reader-dialog').scrollTop=0;}catch(err){toast(err.message);}
}
function renderLibrary(results=null){
  renderCollections();
  const stage=$('knowledge-stage').value;let list=state.articles.filter(a=>stage==='全部'||a.stage===stage);
  if(results){const ids=[...new Set(results.map(x=>x.article_id))];list=ids.map(id=>state.articles.find(a=>a.id===id)).filter(Boolean);}
  $('library-status').textContent=`${list.length} 篇知识 · ${results?'按相关度排列':'点击阅读完整正文'}`;
  $('article-grid').innerHTML=list.map(a=>`<article class="article-card"><span class="tag">${escapeHTML(a.stage)} · ${escapeHTML(a.category)}</span><h3>${escapeHTML(a.title)}</h3><p>${escapeHTML(a.summary)}</p><button data-article="${escapeHTML(a.id)}">阅读知识</button></article>`).join('')||'<div class="panel">未找到匹配内容。尝试更具体的指标或通用术语。</div>';
}
async function searchKnowledge(){const q=$('knowledge-search').value.trim();if(!q){renderLibrary();return;}try{const data=await api('/api/search?q='+encodeURIComponent(q)+'&stage='+encodeURIComponent($('knowledge-stage').value));renderLibrary(data.results);}catch(err){toast(err.message);}}
async function loadAll(){
  const [boot,graph,universe]=await Promise.all([api('/api/bootstrap'),api('/api/graph'),api('/api/universe')]);
  state.token=boot.token;state.articles=boot.articles;state.graph=graph;state.playbooks=boot.playbooks;
  if(!state.configLoaded){state.configLoaded=true;try{const config=await api('/api/config');applyConnection(config);window.WorkbenchPreferences.connect(api,config.preferences);}catch(err){toast(err.message);}}
  $('side-count').textContent=`${boot.stats.articles} 篇知识 · ${boot.stats.playbooks} 个剧本`;
  $('graph-count').textContent=`${boot.stats.nodes} 个节点 / ${boot.stats.edges} 条关系`;
  if(boot.model_defaults.has_search_key)$('search-key-note').textContent='启动环境已提供搜索密钥；联网仅发送公开检索词。';
  if(boot.model_defaults.has_env_key)$('key-note').textContent+=' 启动环境另有密钥，仅在接口地址匹配时使用。';
  if(!$('base-url').value)$('base-url').value=boot.model_defaults.base_url;
  if(!$('model-name').value)$('model-name').value=boot.model_defaults.model;
  renderNodeList();renderGraph();renderLibrary();
  window.CosmicHome?.update({boot,universe});
}
async function showSources(){try{const data=await api('/api/sources');const sources=[...new Map(data.sources.map(s=>[s.url,s])).values()];$('reader-stage').textContent='公开研究与方法依据';$('reader-title').textContent='来源及适用边界';$('reader-content').innerHTML=markdown(sources.map(s=>`### ${s.title}\n\n[阅读公开来源](${s.url})\n\n适用范围：${s.scope||'见相关知识正文'}\n\n边界：${s.limits||'研究条件须与实际场景核对，不能直接视为现场因果证据。'}`).join('\n\n'));$('reader-dialog').showModal();}catch(err){toast(err.message);}}
function wire(){
  for(const id of ['base-url','protocol','model-name'])$(id).addEventListener('input',()=>{$('allow-send').checked=false;if(id==='base-url')$('api-key').value='';});
  document.querySelectorAll('.nav').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
  document.querySelectorAll('.brand,.cosmos-brand').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();switchView('home');}));
  document.querySelectorAll('[data-open-view]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.openView)));
  document.querySelectorAll('.close-dialog').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
  document.addEventListener('click',e=>{const a=e.target.closest('[data-article]');if(a)openArticle(a.dataset.article);const n=e.target.closest('[data-node]');if(n){state.selectedNode=n.dataset.node;renderNodeList();renderGraph();}});
  $('graph-svg').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.dataset.node){e.preventDefault();state.selectedNode=e.target.dataset.node;renderNodeList();renderGraph();}});
  $('download-packet').addEventListener('click',()=>download('separator-context.json',JSON.stringify({version:'0.1.0',messages:state.packet.messages,knowledge_chars:state.packet.knowledge_chars,method:state.packet.method},null,2),'application/json;charset=utf-8'));
  $('copy-packet').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('packet-preview').textContent);toast('已复制分析材料。');}catch{toast('当前浏览器无法自动复制，可选中材料正文复制。');}});
  $('knowledge-stage').addEventListener('change',searchKnowledge);$('search-btn').addEventListener('click',searchKnowledge);$('knowledge-search').addEventListener('keydown',e=>{if(e.key==='Enter')searchKnowledge();});
  $('node-search').addEventListener('input',renderNodeList);
  $('graph-stages').addEventListener('click',e=>{const b=e.target.closest('[data-stage]');if(!b)return;state.graphStage=b.dataset.stage;document.querySelectorAll('#graph-stages button').forEach(x=>x.classList.toggle('active',x===b));state.selectedNode=null;renderNodeList();renderGraph();});
  $('node-read').addEventListener('click',()=>{const n=state.graph.nodes.find(n=>n.id===state.selectedNode);if(n?.article_ids?.length)openArticle(n.article_ids[0]);});
  $('sources-btn').addEventListener('click',showSources);$('export-package').addEventListener('click',()=>{const a=document.createElement('a');a.href='/api/package';a.download='separator-knowledge.zip';a.click();});
  $('refresh-btn').addEventListener('click',async()=>{try{await api('/api/reload',{});await loadAll();toast('知识已重新载入。');}catch(err){toast(err.message);}});
  $('save-settings').addEventListener('click',async()=>{const button=$('save-settings');button.disabled=true;try{const data=await api('/api/config',{action:'save',settings:{...modelSettings(),context_chars:Number($('context-budget').value)},allow_send:$('allow-send').checked});applyConnection(data);$('api-key').value='';$('connection-status').className='';$('connection-status').textContent='连接配置已保存，重开可继续使用；可点击测试连接确认服务状态。';toast('连接已保存。');}catch(err){toast(err.message);}finally{button.disabled=false;}});
  $('delete-key').addEventListener('click',async()=>{try{const data=await api('/api/config',{action:'delete_key'});applyConnection(data);$('api-key').value='';toast('已删除本机保存的模型密钥。');}catch(err){toast(err.message);}});
  window.addEventListener('separator-preference-error',()=>toast('本机显示偏好未能保存，当前页面设置仍有效。'));
  $('test-model').addEventListener('click',async()=>{
    if(!$('allow-send').checked){toast('请先确认允许向所填模型服务发送请求。');return;}
    $('test-model').disabled=true;$('connection-status').className='';$('connection-status').textContent='正在测试接口，仅发送一条连接测试消息…';
    try{const data=await api('/api/model/test',{settings:modelSettings(),allow_send:true});$('connection-status').textContent=`接口已返回：${data.message}`;}catch(err){$('connection-status').className='error';$('connection-status').textContent=err.message;}finally{$('test-model').disabled=false;}
  });
  try{const saved=JSON.parse(localStorage.getItem('separator.settings')||'{}');$('base-url').value=saved.base_url||'';$('model-name').value=saved.model||'';$('protocol').value=saved.protocol||'chat_completions';$('context-budget').value=saved.context_chars||'16000';}catch{}
}
wire();wireAtlas();window.CosmicHome?.init({api,markdown,escapeHTML,openArticle,switchView,loadAll,modelSettings,toast,download,showPacket});loadAll().then(()=>switchView(location.hash.slice(1)||'home')).catch(err=>{$('side-count').textContent='知识加载失败';window.CosmicHome?.error(err.message);});
