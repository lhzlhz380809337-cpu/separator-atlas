'use strict';
let atlasZoom=1;
function svgElement(name,attrs={},text){const el=document.createElementNS('http://www.w3.org/2000/svg',name);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,v);if(text!==undefined)el.textContent=text;return el;}
function nodeKind(n){return n.type==='工序'?'工序':n.type==='材料'?'材料':n.type==='方法'?'方法':['缺陷机理','设备状态','过程状态'].includes(n.type)?'机理':(n.type==='缺陷'||['cell_short','cell_heat_risk','cell_local_weak'].includes(n.id))?'缺陷':'物性';}
const atlasColors={'工序':'#73dacc','物性':'#91b8ee','缺陷':'#ddb486','材料':'#bcaaeb','机理':'#b5acdf','方法':'#8ac4cf'};
function atlasMatches(n,q){return (n.stage+' '+n.label+' '+n.summary+' '+(n.aliases||[]).join(' ')).toLowerCase().includes(q);}
function renderNodeList(){
  const q=$('node-search').value.trim().toLowerCase();const nodes=state.graph.nodes.filter(n=>(state.graphStage==='全部'||n.stage===state.graphStage)&&q&&atlasMatches(n,q));
  $('node-list').hidden=!q;
  $('node-list').innerHTML=nodes.map(n=>`<button class="node-item ${state.selectedNode===n.id?'selected':''}" data-node="${escapeHTML(n.id)}"><small>${escapeHTML(n.stage)} · ${escapeHTML(n.type)}</small>${escapeHTML(n.label)}</button>`).join('')||'<p class="subtle">没有匹配节点。</p>';
}
function drawAtlas(){
  const svg=$('graph-svg');svg.replaceChildren();const stages=state.graphStage==='全部'?['基膜','涂覆','电芯']:[state.graphStage];
  const kinds=['工序','材料','物性','缺陷','机理','方法'],cell=118,gap=20;
  const nodes=state.graph.nodes.filter(n=>stages.includes(n.stage)),positions=new Map();
  const order='base_feed base_extrude base_filter base_cast base_cool base_md base_td base_sync base_traction base_extract base_recycle base_post_td base_dry base_set base_wind base_slit base_condition coat_dispersion_process coat_filter coat_application coat_drying coat_slitting coat_winding coat_package cell_assembly cell_heatpress cell_baking cell_filling'.split(' ');
  nodes.sort((a,b)=>{const ai=order.indexOf(a.id),bi=order.indexOf(b.id);return (ai<0?999:ai)-(bi<0?999:bi);});
  let width=gap;const lanes=stages.map(stage=>{const columns=stages.length===3?({'基膜':6,'涂覆':4,'电芯':3}[stage]):7;const laneWidth=columns*cell+24,x=width;let y=94;const bands=[];
    for(const kind of kinds){const list=nodes.filter(n=>n.stage===stage&&nodeKind(n)===kind);if(!list.length)continue;const rows=Math.ceil(list.length/columns);bands.push({kind,y,list});y+=20+rows*38+14;}
    width+=laneWidth+gap;return {stage,columns,x,laneWidth,bands,height:y};});
  const height=Math.max(...lanes.map(l=>l.height))+4;svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
  const fitWidth=Math.max($('graph-viewport').clientWidth||1200,matchMedia('(max-width:580px)').matches?860:state.selectedNode?1100:0);
  svg.style.width=`${fitWidth*atlasZoom}px`;svg.style.minWidth='0';
  const defs=svgElement('defs');const arrow=svgElement('marker',{id:'atlas-arrow',markerWidth:6,markerHeight:6,refX:5,refY:3,orient:'auto'});arrow.append(svgElement('path',{d:'M0 0 L6 3 L0 6',fill:'#91d4d0'}));defs.append(arrow);svg.append(defs);
  const stageSubs={'基膜':'建立骨架 · 打开孔道 · 稳定膜态','涂覆':'构建涂层 · 管理界面 · 保持通道','电芯':'加工适配 · 离子传输 · 隔离可靠性'};
  lanes.forEach(({stage,x,laneWidth,bands,columns})=>{const g=svgElement('g',{class:'atlas-lane'});g.append(svgElement('rect',{x,y:8,width:laneWidth,height:height-20,rx:20}));g.append(svgElement('text',{x:x+22,y:44,class:'lane-number'},'0'+(['基膜','涂覆','电芯'].indexOf(stage)+1)));g.append(svgElement('text',{x:x+55,y:44,class:'lane-title'},stage==='基膜'?'基膜制造':stage==='涂覆'?'涂覆加工':'电芯应用'));g.append(svgElement('text',{x:x+22,y:73,class:'lane-sub'},stageSubs[stage]));svg.append(g);
    bands.forEach(b=>{g.append(svgElement('text',{x:x+16,y:b.y+4,class:'band-label'},b.kind==='物性'?'结构 / 物性 / 表现':b.kind==='缺陷'?'现场缺陷 / 失效':b.kind==='机理'?'过程机理 / 设备状态':b.kind==='方法'?'诊断方法':b.kind));b.list.forEach((n,j)=>positions.set(n.id,{x:x+12+(j%columns)*cell,y:b.y+14+Math.floor(j/columns)*38}));});
  });
  const selected=state.selectedNode;const related=new Set(selected?[selected]:[]);const activeEdges=state.graph.edges.filter(e=>e.source===selected||e.target===selected);activeEdges.forEach(e=>{related.add(e.source);related.add(e.target);});
  const edgeLayer=svgElement('g',{class:'atlas-edges'});const available=state.graph.edges.filter(e=>positions.has(e.source)&&positions.has(e.target));
  for(const e of [...available.filter(e=>!activeEdges.includes(e)),...available.filter(e=>activeEdges.includes(e))]){const a=positions.get(e.source),b=positions.get(e.target),on=activeEdges.includes(e);let x1=a.x+53,y1=a.y+30,x2=b.x+53,y2=b.y;
    let d;if(Math.abs(a.x-b.x)>cell*2){x1=a.x+106;y1=a.y+15;x2=b.x;y2=b.y+15;const mid=(x1+x2)/2;d=`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`;}else{const bend=Math.max(22,Math.abs(y2-y1)*.45);if(y2<y1){x1=a.x+106;y1=a.y+15;x2=b.x+106;y2=b.y+15;d=`M${x1},${y1} C${Math.max(x1,x2)+12},${y1} ${Math.max(x1,x2)+12},${y2} ${x2},${y2}`;}else d=`M${x1},${y1} C${x1},${y1+bend} ${x2},${y2-bend} ${x2},${y2}`;}
    const p=svgElement('path',{d,class:on?'atlas-edge lit':'atlas-edge','data-edge':e.id,opacity:selected?(on?1:.045):.14});if(on)p.setAttribute('marker-end','url(#atlas-arrow)');p.append(svgElement('title',{},state.graph.nodes.find(n=>n.id===e.source).label+' → '+state.graph.nodes.find(n=>n.id===e.target).label));edgeLayer.append(p);
  }svg.append(edgeLayer);
  for(const n of nodes){const pos=positions.get(n.id),kind=nodeKind(n),g=svgElement('g',{class:'atlas-node'+(n.id===selected?' selected':'')+(selected&&!related.has(n.id)?' dimmed':''),transform:`translate(${pos.x} ${pos.y})`,tabindex:0,role:'button','aria-label':n.stage+' · '+n.label,'data-node':n.id});g.style.setProperty('--node-color',atlasColors[kind]);g.append(svgElement('rect',{width:106,height:30,rx:7}));g.append(svgElement('circle',{cx:9,cy:15,r:2}));const label=n.label.length>7?n.label.slice(0,6)+'…':n.label;g.append(svgElement('text',{x:17,y:19},label));g.append(svgElement('title',{},n.label+'\n'+n.summary));svg.append(g);}
  $('map-caption').textContent=selected?'关系聚焦 · '+state.graph.nodes.find(n=>n.id===selected).label:state.graphStage==='全部'?'全流程关系总览':state.graphStage+'关系总览';
  $('map-visible-count').textContent=`${nodes.length} 个节点 · ${available.length} 条区内及跨区关系`;$('graph-zoom-label').textContent=Math.round(atlasZoom*100)+'%';
}
function renderGraph(){
  const node=state.graph.nodes.find(n=>n.id===state.selectedNode);if(!node)state.selectedNode=null;$('atlas-detail').hidden=!node;$('atlas-layout').classList.toggle('with-detail',!!node);drawAtlas();if(!node)return;
  $('node-category').textContent=node.stage+' / '+node.type;$('node-title').textContent=node.label;$('node-summary').textContent=node.summary;$('node-read').disabled=!node.article_ids?.length;
  const edges=state.graph.edges.filter(e=>e.source===node.id||e.target===node.id),byId=Object.fromEntries(state.graph.nodes.map(n=>[n.id,n]));$('edge-count').textContent=edges.length+' 条直接关系';
  const items=arr=>`<ul>${(arr||[]).map(x=>`<li>${escapeHTML(x)}</li>`).join('')}</ul>`;
  let diagnosis=$('node-diagnosis');if(!diagnosis){diagnosis=document.createElement('div');diagnosis.id='node-diagnosis';$('node-read').after(diagnosis);}diagnosis.hidden=!node.diagnosis;
  const d=node.diagnosis;diagnosis.innerHTML=d?`<section class="diagnosis-intro"><h3>先确认什么</h3>${items(d.first_checks)}<details><summary>候选分支与复验</summary><h4>按实物分流</h4>${items(d.branches)}<h4>可能影响</h4>${items(d.impact)}<h4>验证与复验</h4>${items(d.verification)}</details></section>`:'';
  edges.sort((a,b)=>Number(a.relation==='诊断判别')-Number(b.relation==='诊断判别'));
  const edgeLabel=e=>e.relation==='诊断判别'?'诊断判别 · 需要实物证据':e.relation==='可能传递'?'跨工序 · 核对同源位置':e.relation==='风险传递'?'下游风险 · 条件成立时':e.target===node.id?'上游如何影响它':'它如何影响下游';
  $('edge-list').innerHTML=edges.map((e,i)=>`<details name="atlas-relations" class="edge-card" id="detail-${escapeHTML(e.id)}" ${i===0?'open':''}><summary><small>${escapeHTML(edgeLabel(e))}</small>${escapeHTML(byId[e.source]?.label)} <span>→</span> ${escapeHTML(byId[e.target]?.label)}</summary><div class="relation-section"><h4><b>01</b> 为什么有关联</h4><p>${escapeHTML(e.mechanism)}</p></div><div class="relation-section"><h4><b>02</b> 由此要控制什么</h4>${items(e.control_points)}</div><div class="relation-section"><h4><b>03</b> 控制不好会怎样</h4>${items(e.failure_modes)}</div><div class="relation-section"><h4><b>04</b> 怎样验证</h4>${items(e.checks)}</div><p class="relation-condition">适用时留意：${escapeHTML((e.conditions||[]).join('；'))}</p></details>`).join('');
}
function renderCollections(){
  const entries=[['全部','全部知识','连接全流程的知识底座'],['基膜','基膜制造','材料、成孔与膜态'],['涂覆','涂覆加工','浆料、涂层与界面'],['电芯','电芯应用','加工、传输与可靠性'],['方法','分析方法','测量、验证与改善']];
  $('library-collections').innerHTML=entries.map(([id,label,sub],i)=>`<button data-collection="${id}" class="collection-card ${$('knowledge-stage').value===id?'selected':''}"><span class="collection-num">0${i+1}</span><strong>${label}</strong><small>${sub}</small><span class="collection-count">${state.articles.filter(a=>id==='全部'||a.stage===id).length} 篇 <b>↗</b></span></button>`).join('');
}
function wireAtlas(){
  let resizeFrame;window.addEventListener('resize',()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{if($('view-graph').classList.contains('active'))drawAtlas();});});
  const reset=()=>{state.selectedNode=null;state.graphStage='全部';atlasZoom=1;$('node-search').value='';document.querySelectorAll('#graph-stages button').forEach(b=>b.classList.toggle('active',b.dataset.stage==='全部'));renderNodeList();renderGraph();};
  $('graph-reset').addEventListener('click',reset);$('node-close').addEventListener('click',()=>{state.selectedNode=null;renderGraph();});
  for(const [id,step]of [['graph-zoom-in',.2],['graph-zoom-out',-.2]])$(id).addEventListener('click',()=>{atlasZoom=Math.max(.6,Math.min(2.4,atlasZoom+step));drawAtlas();});
  $('graph-svg').addEventListener('click',e=>{const p=e.target.closest('[data-edge]');if(!p)return;const edge=state.graph.edges.find(x=>x.id===p.dataset.edge);if(!edge)return;if(![edge.source,edge.target].includes(state.selectedNode)){state.selectedNode=edge.source;renderGraph();}const d=$('detail-'+edge.id);if(d){d.open=true;d.scrollIntoView({block:'nearest',behavior:'smooth'});}});
  $('node-list').addEventListener('click',e=>{if(e.target.closest('[data-node]')){$('node-search').value='';setTimeout(()=>{$('node-list').hidden=true;},0);}});
  document.addEventListener('click',e=>{if(!e.target.closest('.atlas-search'))$('node-list').hidden=true;});
  $('library-collections').addEventListener('click',e=>{const b=e.target.closest('[data-collection]');if(b){$('knowledge-stage').value=b.dataset.collection;searchKnowledge();}});
}
