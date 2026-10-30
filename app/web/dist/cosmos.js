'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const COLORS = {'基膜':[98,209,221],'涂覆':[164,158,246],'电芯':[233,184,120],'方法':[120,161,211],'外部':[244,207,142]};
  const color = (rgb,a=1) => `rgba(${rgb.join(',')},${Math.max(0,Math.min(1,a))})`;
  const hash = value => {let h=2166136261;for(const c of value){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}h^=h>>>16;h=Math.imul(h,0x7feb352d);h^=h>>>15;h=Math.imul(h,0x846ca68b);h^=h>>>16;return (h>>>0)/4294967295;};
  const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
  let helpers, sphere, articles=[], turns=[], isBusy=false, syncing=false, visible=true, initialized=false, lastCustom={loaded:0,issues:[]};

  class KnowledgeSphere {
    constructor(canvas,onSelect) {
      this.canvas=canvas;this.ctx=canvas.getContext('2d');this.onSelect=onSelect;this.nodes=[];this.edges=[];this.arrivals=[];this.byId=new Map();this.points=[];
      this.yaw=.3;this.pitch=-.12;this.zoom=1;this.activeNodes=new Set();this.activeEdges=new Set();this.selected=null;this.hover=null;this.busy=false;this.visible=true;
      this.paused=window.matchMedia('(prefers-reduced-motion: reduce)').matches;this.time=0;this.last=0;this.frame=0;this.drag=null;this.pauseUntil=0;
      this.stars=Array.from({length:240},(_,i)=>({x:hash('starx'+i),y:hash('stary'+i),r:.3+hash('starr'+i)*.9,a:.12+hash('stara'+i)*.48,phase:hash('starp'+i)*6.28}));
      this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(canvas);this.resize();this.events();this.animate=this.animate.bind(this);this.frame=requestAnimationFrame(this.animate);
    }
    resize(){const rect=this.canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;this.w=rect.width;this.h=rect.height;this.dpr=Math.min(devicePixelRatio||1,2);this.canvas.width=Math.round(this.w*this.dpr);this.canvas.height=Math.round(this.h*this.dpr);this.ctx.setTransform(this.dpr,0,0,this.dpr,0,0);}
    setData(data){
      const old=this.byId;this.nodes=data.nodes.map((n,i)=>{const y=1-2*hash(n.id+'latitude');const angle=hash(n.id+'longitude')*Math.PI*2;const radius=Math.sqrt(1-y*y);const shell=n.kind==='article'?.98:1;const p={x:Math.cos(angle)*radius*shell,y:y*shell,z:Math.sin(angle)*radius*shell};return {...n,rgb:COLORS[n.stage]||COLORS['方法'],p,degree:0,born:old.size&&!old.has(n.id)?this.time:-100};});
      this.byId=new Map(this.nodes.map(n=>[n.id,n]));this.edges=data.edges.filter(e=>this.byId.has(e.source)&&this.byId.has(e.target));
      for(const e of this.edges){this.byId.get(e.source).degree++;this.byId.get(e.target).degree++;}
      if(this.selected&&!this.byId.has(this.selected))this.select(null);
      for(const id of this.activeNodes)if(!this.byId.has(id))this.activeNodes.delete(id);
    }
    arrive(id){this.activeNodes.add(id);if(!this.paused)this.arrivals.push({id,start:this.time});}
    rotation(p){const c=Math.cos(this.yaw),s=Math.sin(this.yaw),cp=Math.cos(this.pitch),sp=Math.sin(this.pitch);const x=p.x*c+p.z*s,z=-p.x*s+p.z*c;return {x,y:p.y*cp-z*sp,z:p.y*sp+z*cp};}
    activate(ctx){const a=ctx?.activation||{},before=this.activeNodes;this.activeNodes=new Set([...(a.node_ids||[]),...(a.article_ids||[]).map(id=>'doc:'+id)]);this.newNodes=new Set([...this.activeNodes].filter(id=>!before.has(id)));this.activeEdges=new Set(a.edge_ids||[]);this.activeSince=this.time;}
    focus(id){const node=this.byId.get(id);if(!node)return;const yaw=-Math.atan2(node.p.x,node.p.z);this.targetYaw=this.yaw+Math.atan2(Math.sin(yaw-this.yaw),Math.cos(yaw-this.yaw));this.targetPitch=Math.atan2(node.p.y,Math.hypot(node.p.x,node.p.z));this.pauseUntil=this.time+7;this.select(id);}
    select(id){this.selected=id;this.onSelect(id?this.byId.get(id):null);}
    hit(x,y){return this.points.filter(p=>Math.hypot(p.x-x,p.y-y)<Math.max(11,p.r+7)).sort((a,b)=>b.z-a.z)[0]?.node||null;}
    events(){
      const position=e=>{const r=this.canvas.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};};
      this.canvas.addEventListener('pointerdown',e=>{const p=position(e);this.drag={...p,startX:p.x,startY:p.y,moved:false};this.targetYaw=null;this.hover=null;this.canvas.setPointerCapture(e.pointerId);$('universe-tooltip').hidden=true;});
      this.canvas.addEventListener('pointermove',e=>{const p=position(e);if(this.drag){const dx=p.x-this.drag.x,dy=p.y-this.drag.y;this.yaw+=dx*.005;this.pitch=clamp(this.pitch+dy*.005,-1.5,1.5);if(Math.hypot(p.x-this.drag.startX,p.y-this.drag.startY)>5)this.drag.moved=true;this.drag.x=p.x;this.drag.y=p.y;this.pauseUntil=this.time+2;return;}
        const n=this.hit(p.x,p.y);this.hover=n?.id||null;const tooltip=$('universe-tooltip');tooltip.hidden=!n;this.canvas.style.cursor=n?'pointer':'grab';if(n){tooltip.textContent=n.label+(n.kind==='article'?' · 知识正文':'');tooltip.style.left=clamp(p.x+15,8,this.w-245)+'px';tooltip.style.top=clamp(p.y-30,8,this.h-60)+'px';}
      });
      this.canvas.addEventListener('pointerup',e=>{if(this.drag&&!this.drag.moved){const p=position(e);const n=this.hit(p.x,p.y);this.select(n?.id||null);}this.drag=null;this.canvas.releasePointerCapture(e.pointerId);});
      this.canvas.addEventListener('pointercancel',()=>{this.drag=null;});this.canvas.addEventListener('pointerleave',()=>{this.hover=null;$('universe-tooltip').hidden=true;});
      this.canvas.addEventListener('wheel',e=>{e.preventDefault();this.zoom=clamp(this.zoom-e.deltaY*.0006,.65,1.5);},{passive:false});
      this.canvas.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' ','+','-'].includes(e.key)){e.preventDefault();this.targetYaw=null;this.pauseUntil=this.time+3;if(e.key==='ArrowLeft')this.yaw-=.1;if(e.key==='ArrowRight')this.yaw+=.1;if(e.key==='ArrowUp')this.pitch-=.1;if(e.key==='ArrowDown')this.pitch+=.1;if(e.key==='+')this.zoom=clamp(this.zoom+.1,.65,1.5);if(e.key==='-')this.zoom=clamp(this.zoom-.1,.65,1.5);if(e.key===' ')togglePause();}});
    }
    reset(){this.yaw=.3;this.pitch=-.12;this.zoom=1;this.targetYaw=null;this.select(null);}
    animate(stamp){this.frame=requestAnimationFrame(this.animate);if(!this.visible||document.hidden){this.last=stamp;return;}const dt=Math.min((stamp-this.last)/1000,.06);if(stamp-this.last<28)return;this.last=stamp;if(!this.paused)this.time+=dt;
      if(this.targetYaw!==null&&this.targetYaw!==undefined){this.yaw+=(this.targetYaw-this.yaw)*.09;this.pitch+=(this.targetPitch-this.pitch)*.09;if(Math.abs(this.targetYaw-this.yaw)<.002)this.targetYaw=null;}
      else if(!this.paused&&!this.drag&&!this.hover&&this.time>this.pauseUntil)this.yaw+=dt*.043;
      this.draw();
    }
    draw(){
      const c=this.ctx,w=this.w,h=this.h;if(!w||!h)return;c.clearRect(0,0,w,h);const small=w<500;const cx=w*.52,cy=h*(small?.555:.53)+Math.sin(this.time*.35)*5;const R=Math.min(w*.40,h*.365)*this.zoom;
      for(const s of this.stars){const x=(s.x*w+Math.sin(this.time*.025+s.phase)*3),y=s.y*h;const a=s.a*(.82+.18*Math.sin(this.time*.3+s.phase));c.fillStyle=`rgba(143,179,208,${a})`;c.beginPath();c.arc(x,y,s.r,0,Math.PI*2);c.fill();}
      const aura=c.createRadialGradient(cx,cy,R*.1,cx,cy,R*1.55);aura.addColorStop(0,'rgba(39,97,130,.065)');aura.addColorStop(.5,'rgba(30,89,126,.075)');aura.addColorStop(.76,'rgba(43,87,124,.025)');aura.addColorStop(1,'rgba(20,30,60,0)');c.fillStyle=aura;c.fillRect(0,0,w,h);
      c.save();c.translate(cx,cy);c.rotate(-.23);c.strokeStyle='rgba(83,137,168,.065)';c.lineWidth=.7;c.beginPath();c.ellipse(0,0,R*1.23,R*.43,0,0,Math.PI*2);c.stroke();c.rotate(.54);c.strokeStyle='rgba(111,111,175,.045)';c.beginPath();c.ellipse(0,0,R*1.18,R*.62,0,0,Math.PI*2);c.stroke();c.restore();
      c.strokeStyle='rgba(90,152,185,.07)';c.lineWidth=.75;c.beginPath();c.arc(cx,cy,R,0,Math.PI*2);c.stroke();
      const points=this.nodes.map(node=>{const p=this.rotation(node.p),perspective=3.8/(3.8-p.z*.38),depth=(p.z+1)/2;return {node,x:cx+p.x*R*perspective,y:cy+p.y*R*perspective,z:p.z,depth,r:(node.kind==='article'?2.4:1.65)+depth*1.9};});
      const byId=new Map(points.map(p=>[p.node.id,p]));const active=this.activeNodes.size>0,selected=this.selected||this.hover;
      const neighbor=new Set();if(selected)for(const e of this.edges){if(e.source===selected)neighbor.add(e.target);if(e.target===selected)neighbor.add(e.source);}
      for(const e of this.edges){const a=byId.get(e.source),b=byId.get(e.target);if(!a||!b)continue;const lit=this.activeEdges.has(e.id);const picked=selected&&(e.source===selected||e.target===selected);let alpha=(.03+((a.depth+b.depth)/2)*.105)*(e.kind==='mechanism'?1:.55);if(active&&!lit)alpha*=.4;if(lit)alpha=.48;if(picked)alpha=.55;
        c.strokeStyle=lit?'rgba(127,235,219,'+alpha+')':picked?'rgba(171,219,235,'+alpha+')':color(a.node.rgb,alpha);c.lineWidth=lit?1.2:picked?1:.65;c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();
        if(lit&&!this.paused){const f=(this.time*.14+hash(e.id))%1;const px=a.x+(b.x-a.x)*f,py=a.y+(b.y-a.y)*f;c.fillStyle='rgba(177,255,242,.75)';c.beginPath();c.arc(px,py,1.6,0,6.284);c.fill();}
      }
      const sorted=[...points].sort((a,b)=>a.z-b.z);this.points=sorted;
      for(const p of sorted){const n=p.node,lit=this.activeNodes.has(n.id),picked=n.id===selected,near=neighbor.has(n.id),fresh=this.time-n.born<5,newlyLit=this.newNodes?.has(n.id)&&this.time-(this.activeSince||0)<5;let alpha=.22+p.depth*.7;if(newlyLit)alpha=Math.min(1,alpha+.25);if(active&&!lit&&!picked&&!near)alpha*=.35;const rgb=lit?[130,241,219]:n.rgb;const r=p.r+(lit?1.1:0)+(picked?1:0)+(newlyLit?1.3:0);
        if(p.depth>.25||lit||picked){const g=c.createRadialGradient(p.x,p.y,0,p.x,p.y,r*(lit||picked?7:4));g.addColorStop(0,color(rgb,alpha*(lit?.5:.25)));g.addColorStop(1,color(rgb,0));c.fillStyle=g;c.beginPath();c.arc(p.x,p.y,r*(lit||picked?7:4),0,Math.PI*2);c.fill();}
        c.fillStyle=color(rgb,alpha);c.beginPath();c.arc(p.x,p.y,r,0,Math.PI*2);c.fill();c.fillStyle=`rgba(233,253,255,${alpha*.7})`;c.beginPath();c.arc(p.x-r*.2,p.y-r*.2,Math.max(.5,r*.32),0,Math.PI*2);c.fill();
        if(n.kind==='article'){c.strokeStyle=color(rgb,alpha*.55);c.lineWidth=.7;c.beginPath();c.moveTo(p.x,p.y-r-3);c.lineTo(p.x+r+3,p.y);c.lineTo(p.x,p.y+r+3);c.lineTo(p.x-r-3,p.y);c.closePath();c.stroke();}
        if(picked||fresh||newlyLit){const wave=this.paused?0:(this.time*.5+hash(n.id))%1;c.strokeStyle=color(rgb,(1-wave)*.5);c.lineWidth=.8;c.beginPath();c.arc(p.x,p.y,r+5+wave*12,0,6.284);c.stroke();}
      }
      const labels=points.filter(p=>p.z>.05||p.node.id===selected||this.activeNodes.has(p.node.id)).sort((a,b)=>{const score=p=>(p.node.id===selected?200:0)+(this.activeNodes.has(p.node.id)?80:0)+p.node.degree*.5+p.depth*8;return score(b)-score(a);});
      const boxes=[];let labelCount=0;for(const p of labels){if(labelCount>(active?12:9))break;const lit=this.activeNodes.has(p.node.id),picked=p.node.id===selected;if(active&&!lit&&!picked)continue;if(!picked&&p.y<190&&p.x<310)continue;if(!picked&&p.y>h-85)continue;let label=p.node.label;if(label.length>13)label=label.slice(0,12)+'…';c.font=`${picked?'500':'400'} ${picked?14:12}px "Microsoft YaHei",sans-serif`;const tw=c.measureText(label).width;let x=p.x+p.r+9,y=p.y+4;if(x+tw>w-14)x=p.x-p.r-tw-9;const b={x:x-3,y:y-12,w:tw+6,h:19};if(boxes.some(a=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y)&&!picked)continue;boxes.push(b);c.shadowColor='#050a14';c.shadowBlur=6;c.fillStyle=picked?'#e3f7ff':lit?'#b6e7dc':color(p.node.rgb,.45+p.depth*.38);c.fillText(label,x,y);c.shadowBlur=0;labelCount++;}
      this.arrivals=this.arrivals.filter(a=>this.time-a.start<2.1);
      for(const a of this.arrivals){const target=byId.get(a.id);if(!target)continue;const t=clamp((this.time-a.start)/1.8,0,1),f=1-Math.pow(1-t,2);const sx=w*.95,sy=-20,px=sx+(target.x-sx)*f,py=sy+(target.y-sy)*f;const tail=.10*(1-t);const tx=sx+(target.x-sx)*Math.max(0,f-tail),ty=sy+(target.y-sy)*Math.max(0,f-tail);const gradient=c.createLinearGradient(tx,ty,px+.01,py+.01);gradient.addColorStop(0,'rgba(255,212,145,0)');gradient.addColorStop(1,'rgba(255,233,189,.95)');c.strokeStyle=gradient;c.lineWidth=2.2;c.beginPath();c.moveTo(tx,ty);c.lineTo(px,py);c.stroke();c.shadowColor='#ffd693';c.shadowBlur=18;c.fillStyle='#fff2d4';c.beginPath();c.arc(px,py,3,0,Math.PI*2);c.fill();c.shadowBlur=0;if(t>.9){c.strokeStyle='rgba(255,220,164,'+(1-t)*6+')';c.beginPath();c.arc(target.x,target.y,8+(t-.9)*180,0,6.284);c.stroke();}}
      if(this.busy&&!this.paused){c.strokeStyle='rgba(139,222,230,.4)';c.lineWidth=1.1;c.beginPath();c.arc(cx,cy,R*1.07,this.time*.6,this.time*.6+.65);c.stroke();}
    }
  }

  function selection(node){const box=$('universe-selection');box.hidden=!node;if(!node)return;$('selection-stage').textContent=node.stage+' / '+node.type+(node.origin==='user'?' · 自建，未审核':'');$('selection-title').textContent=node.label;$('selection-description').textContent=node.summary;$('selection-read').disabled=!node.article_ids?.length&&node.origin!=='external';$('selection-read').textContent=node.origin==='external'?'查看外部资料':'阅读知识';const e=nodeEvidence(node);if($('selection-evidence'))$('selection-evidence').hidden=!e.chunks.length&&!e.edges.length;}
  function nodeEvidence(node){
    if(!node||!displayedContext)return {chunks:[],edges:[]};
    const edges=(displayedContext.related_edges||[]).filter(e=>e.source===node.id||e.target===node.id);
    const paths=(displayedContext.retrieval_trace||[]).filter(t=>(t.node_ids||[]).includes(node.id));
    const aids=new Set([...(node.article_ids||[]),...edges.flatMap(e=>e.article_ids||[]),...paths.flatMap(t=>t.article_ids||[])]);
    return {chunks:(displayedContext.retrieved||[]).filter(c=>aids.has(c.article_id)),edges};
  }
  function showEvidence(node){
    const e=nodeEvidence(node);if(!e.chunks.length&&!e.edges.length)return;
    $('reader-stage').textContent='本轮查阅依据 · 不代表已确认根因';$('reader-title').textContent=node.label;
    const box=$('reader-content');box.replaceChildren();const intro=document.createElement('p');
    intro.textContent='以下是该轮提供的知识片段和关系。历史片段保持原样，完整知识可能已更新。';box.append(intro);
    for(const c of e.chunks){
      const section=document.createElement('section');section.className='retrieval-excerpt';
      const title=document.createElement('h3');title.textContent=c.title+' · '+c.heading;
      const reason=document.createElement('p');reason.className='retrieval-reason';reason.textContent=c.reason||'本轮关键词检索';
      const body=document.createElement('pre');body.textContent=c.text;
      const read=document.createElement('button');read.textContent='阅读当前完整知识';read.addEventListener('click',()=>helpers.openArticle(c.article_id));
      section.append(title,reason,body,read);box.append(section);
    }
    for(const edge of e.edges){
      const section=document.createElement('section');section.className='retrieval-excerpt';
      const title=document.createElement('h3');title.textContent=edge.source_label+' → '+edge.target_label;
      const body=document.createElement('p');body.textContent=edge.mechanism;
      const conditions=document.createElement('p');conditions.textContent='适用条件：'+(edge.conditions||[]).join('；');
      const checks=document.createElement('p');checks.textContent='核查方法：'+(edge.checks||[]).join('；');
      section.append(title,body,conditions,checks);box.append(section);
    }
    if(!$('reader-dialog').open)$('reader-dialog').showModal();
  }
  function togglePause(){sphere.paused=!sphere.paused;const b=$('universe-pause');b.textContent=sphere.paused?'▷':'Ⅱ';b.setAttribute('aria-label',sphere.paused?'继续知识球动画':'暂停知识球动画');b.title=sphere.paused?'继续动画':'暂停动画';}
  function activate(ctx){displayedContext=ctx;sphere.activate(ctx);const a=ctx?.activation||{};const count=a.article_ids?.length||0;$('activation-bar').classList.toggle('lit',count>0);$('activation-label').textContent=count?`本轮查阅 ${count} 篇知识片段 · ${a.edge_ids?.length||0} 条关系`:'知识已就绪，等待你的问题';$('activation-clear').hidden=!count;if(sphere.selected)selection(sphere.byId.get(sphere.selected));}
  let followFeed=true,autoScrollTop=null;
  function scrollFeed(force=false){const feed=$('cosmic-feed');if(!followFeed&&!force){$('chat-latest').hidden=false;return;}const last=feed.querySelector('.cosmic-message.assistant:last-child');feed.scrollTop=last?feed.scrollTop+last.getBoundingClientRect().top-feed.getBoundingClientRect().top-8:feed.scrollHeight;autoScrollTop=feed.scrollTop;$('chat-latest').hidden=true;}
  function addMessage(role,body){const el=document.createElement('article');el.className='cosmic-message '+role;el.innerHTML=`<div class="message-meta">${role==='user'?'你':'<span>✦</span> 隔膜研析'}</div><div class="message-body">${body}</div>`;$('cosmic-feed').append(el);return el;}
  function status(text,error=false){$('cosmic-chat-status').textContent=text;$('cosmic-chat-status').title=text;$('cosmic-chat-status').classList.toggle('error',error);}
  let lastPacket=null, displayedContext=null, analysisState=null, researchSet=null, externalNodes=new Map(), baseUniverse=null, restored=false, ftaTree=null, branchNodeId='';
  const ftaView={x:0,y:0,scale:1,worldWidth:800,worldHeight:500,selectedId:'',dragging:false,moved:false,suppressClick:false,pointerId:null,startX:0,startY:0,originX:0,originY:0};
  const sessions=window.SeparatorSession, memoryKey='separator.dialogue.v6', legacyMemoryKeys=['separator.dialogue.v5','separator.dialogue.v4','separator.dialogue.v3'];
  let handoff={text:'',through:0}, pendingSession=null;
  function currentSession(){return sessions.create(turns,handoff,$('cosmic-question').value,analysisState,ftaTree);}
  function persist(){if(!$('cosmic-remember').checked)return;try{localStorage.setItem(memoryKey,turns.length?JSON.stringify(currentSession()):'null');}catch{helpers.toast('本机记录未能保存，请用“保存进度”下载备份。');}}
  function updatePlanButton(){const b=$('cosmic-plan');b.disabled=isBusy||!turns.length;const active=new Set((analysisState?.facts||[]).filter(f=>f.status==='reported').map(f=>f.id));const basis=analysisState?.plan_basis||{};const has=k=>(basis[k]||[]).some(id=>active.has(id));const ready=has('scope')&&has('action')&&(has('location')||has('comparison'))&&!(analysisState?.facts||[]).some(f=>f.status==='disputed');b.classList.toggle('is-ready',!!ready);b.title=ready?'当前依据可形成阶段方案，根因仍需验证':'可随时根据已有信息生成初步方案';}
  function setChatBusy(value){isBusy=value;sphere.busy=value;updatePlanButton();for(const id of ['cosmic-send','cosmic-new','research-run','cosmic-load','session-download','session-summarize','session-confirm-load','session-backup','fta-branch-submit'])if($(id))$(id).disabled=value;for(const id of ['cosmic-conclude','cosmic-export','cosmic-save','fta-open'])$(id).disabled=value||!turns.length;$('session-notes').disabled=value;$('session-compact').disabled=value;$('cosmic-packet').disabled=value||!lastPacket;document.querySelectorAll('.reply-options button,.fta-action').forEach(b=>b.disabled=value||b.dataset.unavailable==='true'||(b.dataset.turn!==undefined&&Number(b.dataset.turn)!==turns.length-1));}
  function showExternal(source){$('reader-stage').textContent='外部检索 · 待核验';$('reader-title').textContent=source.title;$('reader-content').innerHTML=helpers.markdown(`检索时间：${source.retrieved_at}\n\n${source.status}\n\n${source.excerpt}\n\n[查看原始网页](${source.url})`);if(!$('reader-dialog').open)$('reader-dialog').showModal();}
  function integrateSources(sources,animate=true){const added=[];for(const s of sources||[]){if(!externalNodes.has(s.id))added.push(s.id);externalNodes.set(s.id,s);}if(baseUniverse){const nodes=[...baseUniverse.nodes,...[...externalNodes.values()].map(s=>({id:s.id,label:s.title,stage:'外部',type:'待核验资料',kind:'external',origin:'external',summary:s.status,article_ids:[]}))];const edges=[...baseUniverse.edges];for(const s of externalNodes.values())for(const target of s.anchor_ids||[])if(baseUniverse.nodes.some(n=>n.id===target))edges.push({id:'research:'+s.id+':'+target,source:s.id,target,kind:'external',relation:'同次检索的参考资料，不代表因果'});sphere.setData({nodes,edges});$('universe-node-count').textContent=nodes.length;$('universe-edge-count').textContent=edges.length;if(animate)for(const id of added)sphere.arrive(id);}}
  function renderTurn(turn,index){addMessage('user',helpers.escapeHTML(turn.question));const optionLines=new Set((turn.options||[]).map(o=>o.value+'．'+o.label));const display=turn.report.split('\n').filter(line=>!optionLines.has(line)).join('\n');const el=addMessage('assistant',`<div class="markdown">${helpers.markdown(display)}</div>`);const relight=document.createElement('button');relight.className='activate-turn';relight.textContent='点亮本轮依据';relight.addEventListener('click',()=>{activate(turn.context);for(const id of turn.external_used||[])sphere.activeNodes.add(id);});el.querySelector('.message-meta').append(relight);
    const shownOptions=turn.turn_kind&&turn.turn_kind!=='dialogue'?turn.resume_pending?.options:turn.options;if(shownOptions?.length){const choices=document.createElement('div');choices.className='reply-options';for(const o of shownOptions){const b=document.createElement('button');b.textContent=o.value+' · '+o.label;b.dataset.turn=index;b.addEventListener('click',()=>{if(index===turns.length-1)ask(o.value);});choices.append(b);}el.append(choices);}
    if((turn.phase||'').startsWith('阶段性结论')&&index===turns.length-1){const actions=document.createElement('div');actions.className='conclusion-actions';const deeper=document.createElement('button');deeper.textContent='继续深入分析';deeper.addEventListener('click',()=>ask('继续深入分析'));const tree=document.createElement('button');tree.textContent='查看 FTA 分析树';tree.addEventListener('click',openFta);actions.append(deeper,tree);el.append(actions);}
    const caption=document.createElement('div');caption.className='cosmic-ref-caption';caption.textContent=turn.mode==='model'?(turn.phase||'模型对话'):(turn.phase||'分析草案')+' · 历史本地引导';el.append(caption);
    const refs=document.createElement('div');refs.className='cosmic-refs';for(const id of turn.context?.activation?.article_ids||[]){const a=articles.find(a=>a.id===id);if(!a)continue;const b=document.createElement('button');b.textContent=a.title;b.addEventListener('click',()=>{sphere.focus('doc:'+id);helpers.openArticle(id);});refs.append(b);}for(const s of turn.sources||[]){const b=document.createElement('button');b.className='external-ref';b.textContent='↗ '+s.title;b.addEventListener('click',()=>{sphere.focus(s.id);showExternal(s);});refs.append(b);}const evidence=document.createElement('details');const evidenceTitle=document.createElement('summary');evidenceTitle.textContent=`本轮知识依据 · ${turn.context?.activation?.article_ids?.length||0} 篇本地 · ${turn.sources?.length||0} 条外部`;evidence.append(evidenceTitle,refs);el.append(evidence);for(const warning of turn.warnings||[]){const p=document.createElement('p');p.className='cosmic-warning';p.textContent=warning;el.append(p);}return el;
  }
  function renderConversation(){const feed=$('cosmic-feed'),oldTop=feed.scrollTop,wasFollowing=followFeed;feed.querySelectorAll('.cosmic-message').forEach(el=>el.remove());$('cosmic-welcome').hidden=!!turns.length;turns.forEach((t,i)=>{integrateSources(t.sources,false);renderTurn(t,i);});if(turns.length)activate(turns.at(-1).context);setChatBusy(false);followFeed=wasFollowing;if(!wasFollowing)feed.scrollTop=oldTop;scrollFeed();}
  function promptFromTurn(turn){return sessions.questionFromTurn(turn)||'本节点未提出新问题，可补充现场情况继续分析。';}
  function compactText(value,max=52){const clean=String(value||'').replace(/\s+/g,' ').trim();return clean.length>max?clean.slice(0,max-1)+'…':clean;}
  function ftaLayout(){
    const byId=new Map(ftaTree.nodes.map(n=>[n.id,n])),children=new Map();for(const node of ftaTree.nodes)children.set(node.id,[]);for(const node of ftaTree.nodes)if(node.parent_id)children.get(node.parent_id)?.push(node);
    const root=ftaTree.nodes.find(n=>!n.parent_id),positions=new Map();let leaf=0;
    function place(node,depth){const kids=children.get(node.id)||[];let y;if(!kids.length)y=50+(leaf++)*122;else{const ys=kids.map(child=>place(child,depth+1));y=(ys[0]+ys.at(-1))/2;}positions.set(node.id,{x:50+depth*244,y});return y;}
    place(root,0);let maxX=0,maxY=0;for(const point of positions.values()){maxX=Math.max(maxX,point.x);maxY=Math.max(maxY,point.y);}
    return {byId,positions,width:Math.max(620,maxX+234),height:Math.max(360,maxY+126)};
  }
  function applyFtaView(){const stage=$('fta-stage');stage.style.transform=`translate(${ftaView.x}px,${ftaView.y}px) scale(${ftaView.scale})`;$('fta-zoom').textContent=Math.round(ftaView.scale*100)+'%';}
  function ftaFitScale(){const viewport=$('fta-viewport');return Math.min((viewport.clientWidth-54)/ftaView.worldWidth,(viewport.clientHeight-54)/ftaView.worldHeight,1.15);}
  function zoomFta(next,clientX=null,clientY=null){const viewport=$('fta-viewport'),rect=viewport.getBoundingClientRect(),scale=clamp(next,Math.max(.001,Math.min(.18,ftaFitScale())),2);const px=clientX===null?rect.width/2:clientX-rect.left,py=clientY===null?rect.height/2:clientY-rect.top;const wx=(px-ftaView.x)/ftaView.scale,wy=(py-ftaView.y)/ftaView.scale;ftaView.x=px-wx*scale;ftaView.y=py-wy*scale;ftaView.scale=scale;applyFtaView();}
  function fitFta(){const viewport=$('fta-viewport');if(!viewport.clientWidth||!viewport.clientHeight)return;ftaView.scale=Math.max(.001,ftaFitScale());ftaView.x=(viewport.clientWidth-ftaView.worldWidth*ftaView.scale)/2;ftaView.y=(viewport.clientHeight-ftaView.worldHeight*ftaView.scale)/2;applyFtaView();}
  function actionButton(label,handler,className='',unavailable=false){const button=document.createElement('button');button.className='fta-action '+className;button.textContent=label;button.dataset.unavailable=String(unavailable);button.disabled=isBusy||unavailable;button.addEventListener('click',()=>{if(!isBusy&&!unavailable)handler();});return button;}
  function showFtaDetail(nodeId,resetSummary=true){
    if(!ftaTree?.nodes.some(n=>n.id===nodeId))return;
    const info=sessions.nodeDetail(ftaTree,nodeId),{node,parent}=info;
    ftaView.selectedId=nodeId;document.querySelectorAll('#fta-tree .fta-node').forEach(el=>el.classList.toggle('selected',el.dataset.nodeId===nodeId));
    const active=new Set(sessions.pathNodes(ftaTree).map(n=>n.id)),detail=$('fta-detail');
    $('fta-detail-state').textContent=node.deleted?'已删除 · 可恢复':active.has(node.id)?'当前分析路径':'保留的其他分支';$('fta-detail-title').textContent='节点详情';
    $('fta-previous-label').textContent=parent?'上一题与本次选择':'最初提出的问题';
    $('fta-detail-previous').textContent=info.previousQuestion;$('fta-detail-previous').hidden=!info.previousQuestion;
    $('fta-detail-answer').textContent=(parent?'本次选择：':'')+info.selectedAnswer;
    $('fta-detail-question').textContent=info.question||'本节点已整理阶段结论，尚未提出新的问题。';
    $('fta-detail-report').innerHTML=helpers.markdown(node.turn.report);
    const options=$('fta-detail-options');options.replaceChildren();for(const item of info.options){const row=document.createElement('span');row.textContent=item.value+' · '+item.label;options.append(row);}$('fta-detail-no-options').hidden=!!info.options.length;
    const actions=$('fta-detail-actions');actions.replaceChildren();
    actions.append(actionButton('总结此节点之前的内容',()=>summarizeNode(node.id)));
    actions.append(actionButton('对此问题选择另外选项',()=>openBranch(node.id),'primary-branch',node.deleted));
    actions.append(actionButton('删除此节点及后续',()=>softDeleteNode(node.id),'danger',node.deleted||!parent));
    const notice=$('fta-detail-notice');notice.textContent=node.deleted?'此节点及后续已软删除，原始问答仍保留。':!parent?'初始问题作为整棵树的起点保留，可删除其后任一分支。':'';notice.hidden=!notice.textContent;
    const deletion=ftaTree.deletions.find(d=>d.root_id===node.id&&!d.restored_at);if(deletion)actions.append(actionButton('恢复这段路径',()=>restoreDeletion(deletion.id),'restore'));
    if(resetSummary){$('fta-summary').hidden=true;$('fta-full-report').open=false;$('fta-detail-content').scrollTop=0;}
    if(!detail.open)detail.showModal();
  }
  function renderFta(){
    const box=$('fta-tree'),links=$('fta-links');box.replaceChildren();links.replaceChildren();if(!ftaTree)return;const active=new Set(sessions.pathNodes(ftaTree).map(n=>n.id)),layout=ftaLayout();ftaView.worldWidth=layout.width;ftaView.worldHeight=layout.height;for(const el of [$('fta-stage'),box,links]){el.style.width=layout.width+'px';el.style.height=layout.height+'px';}links.setAttribute('viewBox',`0 0 ${layout.width} ${layout.height}`);
    for(const node of ftaTree.nodes){const point=layout.positions.get(node.id);if(node.parent_id){const parent=layout.positions.get(node.parent_id),path=document.createElementNS('http://www.w3.org/2000/svg','path'),sx=parent.x+184,sy=parent.y+38,tx=point.x,ty=point.y+38,mid=(sx+tx)/2;path.setAttribute('d',`M ${sx} ${sy} C ${mid} ${sy}, ${mid} ${ty}, ${tx} ${ty}`);path.setAttribute('class','fta-link '+(node.deleted||layout.byId.get(node.parent_id).deleted?'deleted':active.has(node.id)&&active.has(node.parent_id)?'active':''));links.append(path);}
      const card=document.createElement('button');card.type='button';card.dataset.nodeId=node.id;card.className='fta-node '+(node.deleted?'deleted':active.has(node.id)?'active':'branch')+(ftaView.selectedId===node.id?' selected':'');card.style.left=point.x+'px';card.style.top=point.y+'px';const state=document.createElement('span');state.className='fta-node-state';state.textContent=node.deleted?'已删除':active.has(node.id)?'当前路径':'其他分支';const title=document.createElement('span');title.className='fta-node-title';title.textContent=compactText(sessions.questionFromTurn(node.turn)||'阶段性结论',46);const prompt=document.createElement('span');prompt.className='fta-node-prompt';prompt.textContent=(node.parent_id?'上题选择 · ':'初始问题 · ')+compactText(sessions.selectedAnswer(node.turn.question,layout.byId.get(node.parent_id)?.turn),34);card.append(state,title,prompt);card.title=promptFromTurn(node.turn);card.setAttribute('aria-label','查看节点：'+promptFromTurn(node.turn));card.addEventListener('click',()=>{if(!ftaView.suppressClick)showFtaDetail(node.id);});box.append(card);
    }
    if($('fta-detail').open&&ftaTree.nodes.some(n=>n.id===ftaView.selectedId))showFtaDetail(ftaView.selectedId,false);applyFtaView();
  }
  function openFta(){if(!ftaTree)return;if(!$('fta-dialog').open)$('fta-dialog').showModal();ftaView.selectedId=ftaTree.active_leaf_id;renderFta();$('fta-summary').hidden=true;requestAnimationFrame(fitFta);}
  function openBranch(nodeId){const node=ftaTree?.nodes.find(n=>n.id===nodeId);if(!node||node.deleted||isBusy)return;branchNodeId=nodeId;$('fta-branch-status').textContent='';$('fta-branch-question').textContent=promptFromTurn(node.turn);$('fta-branch-answer').value='';const choices=$('fta-branch-options');choices.replaceChildren();for(const option of (node.turn.turn_kind==='dialogue'?node.turn.options:node.turn.resume_pending?.options)||[]){const b=document.createElement('button');b.textContent=option.value+' · '+option.label;b.addEventListener('click',()=>{$('fta-branch-answer').value=option.value;choices.querySelectorAll('button').forEach(item=>item.setAttribute('aria-pressed',String(item===b)));});choices.append(b);}$('fta-branch-dialog').showModal();}
  function switchBranch(nodeId){try{ftaTree=sessions.switchFta(ftaTree,nodeId);turns=sessions.turnsTo(ftaTree);analysisState=null;handoff={text:'',through:0};lastPacket=turns.at(-1)?.context||null;renderConversation();renderFta();persist();status('已切换到所选 FTA 分支。下一次回答时会按该路径重建分析进度。');}catch(err){helpers.toast(err.message);}}
  function softDeleteNode(nodeId){try{ftaTree=sessions.deleteFta(ftaTree,nodeId);turns=sessions.turnsTo(ftaTree);analysisState=null;handoff={text:'',through:0};lastPacket=turns.at(-1)?.context||null;renderConversation();renderFta();persist();status('已软删除该答案及其后续，可在 FTA 树中恢复。');}catch(err){helpers.toast(err.message);}}
  function restoreDeletion(id){try{ftaTree=sessions.restoreFta(ftaTree,id);turns=sessions.turnsTo(ftaTree);analysisState=null;handoff={text:'',through:0};lastPacket=turns.at(-1)?.context||null;renderConversation();renderFta();persist();status('已恢复删除前的 FTA 路径。下一轮会按恢复后的对话重建分析进度。');}catch(err){helpers.toast(err.message);}}
  function publicQuery(issue){if(/油斑|油点/.test(issue))return 'wet process polyethylene battery separator oil spots roller contamination extraction';if(/涂覆|陶瓷/.test(issue))return 'lithium ion battery ceramic coated separator permeability coating defects';if(/收缩/.test(issue))return 'polyethylene battery separator thermal shrinkage pore structure';return 'lithium ion battery separator manufacturing quality defect mechanisms';}
  async function fetchResearch(){const query=$('research-query').value.trim();if(!$('cosmic-web').checked){helpers.toast('请先开启联网补充，并检查公开检索词。');return null;}status('正在检索公开资料…');const data=await helpers.api('/api/research',{query,search_key:$('search-key').value,allow_search:true});researchSet={...data,received:Date.now()};const anchors=(lastPacket?.activation.node_ids||[]).slice(0,2);data.sources=data.sources.map(s=>({...s,anchor_ids:anchors}));researchSet.sources=data.sources;integrateSources(data.sources);$('research-label').textContent=data.sources.length?`外部知识 · 已取得 ${data.sources.length} 条待核验资料`:'外部知识 · 本次没有有效结果';status(data.sources.length?'公开资料已进入本次分析星图，适用性待核验。':'未取得有效外部摘录，没有新增节点。');return data;}
  async function ask(question,conclude=false,branch=null,action=''){
    if(isBusy||!question.trim())return;question=question.trim();const mode='model',savedDraft=$('cosmic-question').value,preserveDraft=!!action||conclude;
    let workingFta=ftaTree,workingTurns=turns,workingHandoff=handoff,workingState=analysisState;
    if(branch){try{workingFta=sessions.switchFta(ftaTree,branch.parent_id);workingTurns=sessions.turnsTo(workingFta);workingHandoff={text:'',through:0};workingState=null;}catch(err){helpers.toast(err.message);return;}}
    if(workingTurns.length>=500){helpers.toast('当前进度已达 500 轮，请保存后为新的问题开启对话。');return;}
    let continuation={history:[]};
    try{if(workingTurns.length)continuation=sessions.input(sessions.create(workingTurns,workingHandoff,'',workingState,workingFta));}catch(err){openSave();helpers.toast(err.message);return;}
    if(mode!=='model'&&workingHandoff.through){helpers.toast('这份长对话已分段，请切换“模型对话”接着分析。');return;}
    if(mode==='model'&&(!$('base-url').value.trim()||!$('model-name').value.trim()||!$('allow-send').checked)){if(branch)$('fta-branch-status').textContent='请先关闭此窗口，在模型设置中配置模型并确认可以发送当前问题与知识。';else{if(!preserveDraft)$('cosmic-question').value=question;helpers.switchView('settings');helpers.toast('请先连接模型并保存，问题草稿已保留。');}return;}
    document.querySelectorAll('.chat-more[open],.chat-research[open]').forEach(d=>d.open=false);followFeed=true;setChatBusy(true);if(branch)$('fta-branch-status').textContent='正在沿新选项分析，原分支会保留…';$('cosmic-welcome').hidden=true;$('cosmic-question').value='';const user=addMessage('user',helpers.escapeHTML(question));const pending=addMessage('assistant','<div class="pending-dots" aria-label="正在分析"><i></i><i></i><i></i></div>');scrollFeed();status('正在结合已有问答检索知识…');
    if(!$('research-query').value.trim())$('research-query').value=publicQuery(workingTurns[0]?.question||question);
    try{
      if($('cosmic-web').checked&&(!researchSet||researchSet.query!==$('research-query').value.trim()||Date.now()-researchSet.received>1500000)){try{await fetchResearch();}catch(err){researchSet=null;helpers.toast(err.message);$('research-label').textContent='外部知识 · 检索未完成';}}
      const payload={issue:question,mode,...continuation,conclude,action,depth:window.WorkbenchPreferences.get().depth,context_chars:Number($('context-budget').value),allow_custom:$('model-custom').checked,research_id:$('cosmic-web').checked?researchSet?.research_id||'':''};
      if(branch)payload.branch_context={alternate:true,from_question:branch.from_question,prior_answers:branch.prior_answers||[]};
      if(mode==='model')Object.assign(payload,{settings:helpers.modelSettings(),allow_send:true});
      status(mode==='model'?'正在结合对话进度分析…':'正在整理下一问与验证方向…');
      const data=await helpers.api('/api/dialogue',payload);lastPacket=data.context;activate(data.context);for(const id of data.external_used||[])sphere.activeNodes.add(id);
      const sourceList=$('cosmic-web').checked?researchSet?.sources||[]:[];for(const s of sourceList)if(!s.anchor_ids?.length)s.anchor_ids=(data.context.activation.node_ids||[]).slice(0,2);integrateSources(sourceList,false);
      const turn={question,report:data.report,context:data.context,mode,question_key:data.question_key,options:data.options,phase:data.phase,turn_kind:data.turn_kind,resume_pending:data.resume_pending,external_used:data.external_used||[],sources:sourceList,warnings:data.warnings};
      workingFta=workingFta?sessions.appendFta(workingFta,turn,branch?.parent_id||''):sessions.linearFta([turn]);
      const clean=sessions.create([],workingHandoff,'',data.analysis_state||null,workingFta);analysisState=clean.analysis_state;ftaTree=clean.fta;turns=clean.turns;handoff=workingHandoff;user.remove();pending.remove();renderConversation();if(preserveDraft)$('cosmic-question').value=savedDraft;persist();
      if(branch)ftaView.selectedId=ftaTree.active_leaf_id;if($('fta-branch-dialog').open)$('fta-branch-dialog').close();if($('fta-dialog').open){renderFta();if(branch&&$('fta-detail').open)showFtaDetail(ftaTree.active_leaf_id);}status(data.phase==='逐步排查'?'选择一个回答，或直接输入补充和修正。':'可继续深入分析，也可查看 FTA 树中的其他路径。');
    }catch(err){if(branch)$('fta-branch-status').textContent=err.message+' 原路径仍保留，可重新提交。';pending.querySelector('.message-body').innerHTML='<p class="message-error">'+helpers.escapeHTML(err.message)+'</p>';status('本轮未完成，已有分析记录仍保留。',true);$('cosmic-question').value=preserveDraft?savedDraft:question;scrollFeed();}
    finally{setChatBusy(false);}
  }
  async function summarizeNode(nodeId){if(isBusy||!ftaTree)return;const mode='model';if(!$('base-url').value.trim()||!$('model-name').value.trim()||!$('allow-send').checked){helpers.toast('请先在模型设置中保存连接并确认发送范围。');return;}setChatBusy(true);$('fta-summary').hidden=false;$('fta-summary-title').textContent='正在整理到此节点的结论';$('fta-summary-body').textContent='正在按这条 FTA 路径汇总…';
    try{const continuation=sessions.branchInput(ftaTree,nodeId),node=ftaTree.nodes.find(n=>n.id===nodeId);const payload={issue:'请汇总初始问题至此 FTA 节点的已有问答及阶段性结论，不包含该节点之后的任何回答或分支。',mode,...continuation,conclude:true,summary_to_node:true,branch_context:{alternate:false,from_question:promptFromTurn(node.turn),prior_answers:[]},context_chars:Number($('context-budget').value),allow_custom:$('model-custom').checked};if(mode==='model')Object.assign(payload,{settings:helpers.modelSettings(),allow_send:true});const data=await helpers.api('/api/dialogue',payload);if(ftaView.selectedId!==nodeId)return;$('fta-summary-title').textContent='到此节点的阶段性结论';$('fta-summary-body').innerHTML=helpers.markdown(data.report);$('fta-summary').scrollIntoView({behavior:'smooth',block:'nearest'});}catch(err){if(ftaView.selectedId===nodeId){$('fta-summary-title').textContent='节点总结未完成';$('fta-summary-body').textContent=err.message;}}finally{setChatBusy(false);}}
  function saveFile(session,format='md'){if(format==='json')helpers.download('隔膜分析进度-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(session,null,2),'application/json;charset=utf-8');else helpers.download('隔膜分析进度-'+new Date().toISOString().slice(0,10)+'.md',sessions.markdown(session),'text/markdown;charset=utf-8');}
  function openSave(){
    if(isBusy||!turns.length)return;
    const deleted=ftaTree?.deletions?.filter(d=>!d.restored_at).length||0;
    $('session-save-info').textContent=`保存当前路径 ${turns.length} 轮、FTA 共 ${ftaTree?.nodes?.length||turns.length} 个节点、${deleted} 条未恢复删除记录，以及完整对话和未发送草稿。`;
    $('session-notes').value=handoff.text;$('session-compact').checked=false;$('session-summary-status').textContent='';
    if(!$('session-save-dialog').open)$('session-save-dialog').showModal();
  }
  function editedSession(){
    const notes=$('session-notes').value;
    const through=$('session-compact').checked?Math.max(0,turns.length-1):handoff.through;
    if($('session-compact').checked&&!notes.trim())throw new Error('请先填写或整理交接记录，核对后再采用。');
    return sessions.create(turns,{text:notes,through},$('cosmic-question').value,analysisState,ftaTree);
  }
  function restoreSession(value){
    const clean=sessions.normalize(value);
    turns=clean.turns;ftaTree=clean.fta;handoff=clean.handoff;analysisState=clean.analysis_state;lastPacket=null;researchSet=null;externalNodes.clear();sphere.arrivals=[];
    integrateSources([],false);$('cosmic-feed').querySelectorAll('.cosmic-message').forEach(el=>el.remove());$('cosmic-welcome').hidden=true;
    turns.forEach((t,i)=>{integrateSources(t.sources,false);renderTurn(t,i);});activate(turns.at(-1).context);
    $('cosmic-question').value=clean.draft;$('research-query').value='';$('cosmic-web').checked=false;
    $('research-label').textContent=externalNodes.size?'外部知识 · 历史摘录，需重新检索':'外部知识 · 未开启';
    status(`已恢复当前路径 ${turns.length} 轮、FTA ${ftaTree.nodes.length} 个节点。${handoff.through?'后续使用交接记录与本段问答，请选择模型对话。':'可继续回答，也可在 FTA 树切换或恢复路径。'}`);
    setChatBusy(false);scrollFeed();
  }
  async function summarizeHandoff(){
    if(isBusy)return;
    if(!$('base-url').value.trim()||!$('model-name').value.trim()||!$('allow-send').checked){helpers.toast('请先在模型设置中配置并允许使用模型；也可以直接填写交接记录。');return;}
    let continuation;try{continuation=sessions.input(currentSession(),true);}catch(err){helpers.toast(err.message+'也可以参照完整问答手工填写。');return;}
    setChatBusy(true);$('session-summary-status').textContent='正在整理详细交接记录…';
    try{
      const data=await helpers.api('/api/dialogue',{issue:'请整理本次分析的详细交接记录，供下次或另一位工程师接着排查。',
        action:'handoff',mode:'model',...continuation,context_chars:Number($('context-budget').value),allow_custom:$('model-custom').checked,
        settings:helpers.modelSettings(),allow_send:true});
      if(typeof data.report!=='string'||data.report.length>16000)throw new Error('交接记录过长，未替换原文。请手工整理后保存。');
      $('session-notes').value=data.report;$('session-summary-status').textContent='已整理，请核对事实、否定回答和待验证判断后保存。';
    }catch(err){$('session-summary-status').textContent=err.message;}
    finally{setChatBusy(false);}
  }
  function setupSessions(){
    $('cosmic-save').addEventListener('click',openSave);
    $('session-summarize').addEventListener('click',summarizeHandoff);
    $('session-download').addEventListener('click',()=>{try{const session=editedSession();saveFile(session,'md');handoff=session.handoff;persist();$('session-save-dialog').close();status('已生成可重新载入的 Markdown，包含完整对话和 FTA 删除记录。');}catch(err){helpers.toast(err.message);}});
    $('cosmic-export').addEventListener('click',()=>{try{saveFile(editedSession(),'json');}catch(err){helpers.toast(err.message);}});
    $('cosmic-load').addEventListener('click',()=>{if(!isBusy)$('session-file').click();});
    $('session-file').addEventListener('change',async()=>{
      const file=$('session-file').files[0];$('session-file').value='';if(!file||isBusy)return;pendingSession=null;setChatBusy(true);
      try{
        if(file.size>sessions.MAX_BYTES)throw new Error('请选择不超过 10 MB 的进度文件。');
        pendingSession=sessions.parse(await file.text());
        $('session-load-title').textContent=pendingSession.title;
        $('session-load-info').textContent=`当前路径 ${pendingSession.turns.length} 轮 · FTA ${pendingSession.fta.nodes.length} 个节点 · 保存时间：${pendingSession.saved_at||'未记录'}`;
        $('session-load-preview').textContent=(pendingSession.handoff.text?'交接记录（待核对）\n'+pendingSession.handoff.text+'\n\n':'')+'最后一轮回答\n'+pendingSession.turns.at(-1).report;
        $('session-replace-note').textContent=turns.length||$('cosmic-question').value?'载入会替换当前页面的对话和草稿。需要保留时，请先保存当前进度。':'核对后载入，可直接继续最后的问题。';
        $('session-backup').hidden=!turns.length;$('session-load-dialog').showModal();
      }catch(err){pendingSession=null;helpers.toast(err.message);}
      finally{setChatBusy(false);}
    });
    $('session-backup').addEventListener('click',()=>{try{saveFile(currentSession());}catch(err){helpers.toast(err.message);}});
    $('session-confirm-load').addEventListener('click',()=>{if(isBusy||!pendingSession)return;try{restoreSession(pendingSession);persist();pendingSession=null;$('session-load-dialog').close();$('cosmic-question').focus();}catch(err){helpers.toast(err.message);}});
  }
  function setupDialogue(){
    setupSessions();
    $('cosmic-plan').addEventListener('click',()=>ask('请根据当前对话生成系统方案。',false,null,'system_plan'));
    $('chat-latest').addEventListener('click',()=>{followFeed=true;scrollFeed(true);});
    $('cosmic-feed').addEventListener('scroll',()=>{const f=$('cosmic-feed');if(autoScrollTop!==null&&Math.abs(f.scrollTop-autoScrollTop)<1)return;autoScrollTop=null;followFeed=f.scrollHeight-f.scrollTop-f.clientHeight<80;$('chat-latest').hidden=followFeed;});
    document.addEventListener('click',e=>{for(const d of document.querySelectorAll('.chat-more[open],.chat-research[open]'))if(!d.contains(e.target))d.open=false;});
    document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.chat-more[open],.chat-research[open]').forEach(d=>d.open=false);});
    $('cosmic-conclude').addEventListener('click',()=>ask('请根据目前的问答整理阶段性结论和下一步验证任务。',true));
    $('fta-open').addEventListener('click',openFta);
    $('fta-summary-close').addEventListener('click',()=>$('fta-summary').hidden=true);
    $('fta-detail').addEventListener('close',()=>{const card=Array.from($('fta-tree').children).find(el=>el.dataset.nodeId===ftaView.selectedId);card?.focus({preventScroll:true});});
    $('fta-fit').addEventListener('click',fitFta);$('fta-zoom-in').addEventListener('click',()=>zoomFta(ftaView.scale*1.16));$('fta-zoom-out').addEventListener('click',()=>zoomFta(ftaView.scale/1.16));
    $('fta-maximize').addEventListener('click',()=>{const dialog=$('fta-dialog'),expanded=dialog.classList.toggle('is-maximized');$('fta-maximize').textContent=expanded?'还原':'最大化';$('fta-maximize').setAttribute('aria-pressed',String(expanded));requestAnimationFrame(fitFta);});
    const ftaViewport=$('fta-viewport');ftaViewport.addEventListener('wheel',e=>{e.preventDefault();zoomFta(ftaView.scale*(e.deltaY<0?1.12:1/1.12),e.clientX,e.clientY);},{passive:false});
    // Capture only after actual movement: capturing on pointerdown redirects
    // the click to the viewport and prevents a node button from receiving it.
    ftaViewport.addEventListener('pointerdown',e=>{if(e.button!==0||!e.isPrimary)return;ftaView.dragging=true;ftaView.moved=false;ftaView.suppressClick=false;ftaView.pointerId=e.pointerId;ftaView.startX=e.clientX;ftaView.startY=e.clientY;ftaView.originX=ftaView.x;ftaView.originY=ftaView.y;});
    window.addEventListener('pointermove',e=>{if(!ftaView.dragging||e.pointerId!==ftaView.pointerId)return;const dx=e.clientX-ftaView.startX,dy=e.clientY-ftaView.startY;if(!ftaView.moved&&Math.hypot(dx,dy)>5){ftaView.moved=true;ftaViewport.classList.add('dragging');ftaViewport.setPointerCapture(e.pointerId);}if(ftaView.moved){e.preventDefault();ftaView.x=ftaView.originX+dx;ftaView.y=ftaView.originY+dy;applyFtaView();}},{passive:false});
    const endFtaPan=e=>{if(!ftaView.dragging||e.pointerId!==ftaView.pointerId)return;ftaView.dragging=false;ftaView.suppressClick=ftaView.moved;ftaViewport.classList.remove('dragging');if(ftaViewport.hasPointerCapture(e.pointerId))ftaViewport.releasePointerCapture(e.pointerId);ftaView.pointerId=null;};window.addEventListener('pointerup',endFtaPan);window.addEventListener('pointercancel',endFtaPan);ftaViewport.addEventListener('lostpointercapture',endFtaPan);
    ftaViewport.addEventListener('click',e=>{if(ftaView.suppressClick&&e.detail!==0){e.preventDefault();e.stopPropagation();}ftaView.suppressClick=false;},true);
    ftaViewport.addEventListener('keydown',e=>{const step=42;if(e.key==='+'||e.key==='='){e.preventDefault();zoomFta(ftaView.scale*1.16);}else if(e.key==='-'){e.preventDefault();zoomFta(ftaView.scale/1.16);}else if(e.key==='0'){e.preventDefault();fitFta();}else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();ftaView.x+=e.key==='ArrowLeft'?step:e.key==='ArrowRight'?-step:0;ftaView.y+=e.key==='ArrowUp'?step:e.key==='ArrowDown'?-step:0;applyFtaView();}});
    window.addEventListener('resize',()=>{if($('fta-dialog').open)requestAnimationFrame(fitFta);});
    $('fta-branch-submit').addEventListener('click',()=>{const answer=$('fta-branch-answer').value.trim(),node=ftaTree?.nodes.find(n=>n.id===branchNodeId);if(!answer){$('fta-branch-status').textContent='请选择或填写新的回答。';return;}if(!node)return;const prior=ftaTree.nodes.filter(n=>n.parent_id===node.id&&!n.deleted).map(n=>n.turn.question).slice(-20);ask(answer,false,{parent_id:node.id,from_question:promptFromTurn(node.turn),prior_answers:prior});});
    $('cosmic-packet').addEventListener('click',()=>{if(lastPacket)helpers.showPacket(lastPacket);});
    $('cosmic-remember').addEventListener('change',()=>{try{if(!$('cosmic-remember').checked){localStorage.removeItem(memoryKey);for(const key of legacyMemoryKeys)localStorage.removeItem(key);}else persist();localStorage.setItem('separator.remember',$('cosmic-remember').checked?'yes':'no');}catch{helpers.toast('浏览器未允许保存本机记忆。');}});
    $('cosmic-web').addEventListener('change',()=>{$('research-label').textContent=$('cosmic-web').checked?'外部知识 · 联网补充已开启':'外部知识 · 未开启';});
    $('research-run').addEventListener('click',async()=>{if(isBusy)return;setChatBusy(true);try{await fetchResearch();}catch(err){researchSet=null;status(err.message,true);$('research-label').textContent='外部知识 · 检索未完成';}finally{setChatBusy(false);}});
    const resizer=$('chat-resizer'),workspace=document.querySelector('.cosmos-workspace');let dragging=false;
    const defaultWidth=()=>window.innerWidth<900?94:58;
    function width(value){const ratio=clamp(Number.isFinite(value)?value:defaultWidth(),32,98);workspace.style.setProperty('--chat-width',ratio+'%');resizer.setAttribute('aria-valuenow',Math.round(ratio));resizer.setAttribute('aria-valuemax','98');try{localStorage.setItem('separator.chat-width',ratio);}catch{}const scene=document.querySelector('.universe-scene');const remaining=workspace.clientWidth*(1-ratio/100);scene.querySelectorAll('button,input,a,[tabindex]').forEach(el=>{if(remaining<300){if(!el.hasAttribute('data-old-tabindex'))el.dataset.oldTabindex=el.getAttribute('tabindex')??'';el.tabIndex=-1;}else if(el.hasAttribute('data-old-tabindex')){if(el.dataset.oldTabindex==='')el.removeAttribute('tabindex');else el.setAttribute('tabindex',el.dataset.oldTabindex);delete el.dataset.oldTabindex;}});sphere.resize();}
    try{width(Number(localStorage.getItem('separator.chat-width')||defaultWidth()));$('cosmic-remember').checked=localStorage.getItem('separator.remember')!=='no';}catch{}
    const resetWidth=()=>width(defaultWidth());$('layout-reset').addEventListener('click',resetWidth);
    window.addEventListener('resize',()=>width(Number(resizer.getAttribute('aria-valuenow'))));
    resizer.addEventListener('pointerdown',e=>{dragging=true;resizer.setPointerCapture(e.pointerId);document.body.classList.add('resizing-chat');});resizer.addEventListener('pointermove',e=>{if(!dragging)return;const r=workspace.getBoundingClientRect();width((r.right-e.clientX)/r.width*100);});const release=()=>{dragging=false;document.body.classList.remove('resizing-chat');};resizer.addEventListener('pointerup',release);resizer.addEventListener('pointercancel',release);resizer.addEventListener('lostpointercapture',release);resizer.addEventListener('dblclick',resetWidth);resizer.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home'].includes(e.key)){e.preventDefault();width(e.key==='Home'?defaultWidth():Number(resizer.getAttribute('aria-valuenow'))+(e.key==='ArrowLeft'?2:-2));}});
  }

  function customStatus(custom){lastCustom=custom||{loaded:0,issues:[]};$('cosmic-sync-label').textContent=`自建知识 ${lastCustom.loaded} 篇`;const s=$('inbox-status');s.textContent=`已载入 ${lastCustom.loaded} 篇自建知识。星图打开时每 25 秒检查一次变化。`;if(lastCustom.issues?.length){const ul=document.createElement('ul');for(const item of lastCustom.issues){const li=document.createElement('li');li.textContent=item.reason+'（条目标识 '+item.id.slice(-6)+'）';ul.append(li);}s.append(ul);}}
  async function sync(manual=false){if(syncing||isBusy)return;syncing=true;$('cosmic-sync').disabled=true;$('inbox-sync').disabled=true;try{const data=await helpers.api('/api/custom/sync',{force:manual});customStatus(data.custom);if(data.changed){await helpers.loadAll();if(data.custom.issues.length)helpers.toast('同步完成，有条目需要按扩充知识窗口的提示调整。');else helpers.toast(`知识已更新：${data.custom.loaded} 篇自建知识`);}else if(manual)helpers.toast('知识已同步，当前没有新变化。');}catch(err){if(manual)helpers.toast(err.message);}finally{syncing=false;$('cosmic-sync').disabled=false;$('inbox-sync').disabled=false;}}
  function searchNodes(){const q=$('universe-search').value.trim().toLowerCase();const list=$('universe-search-results');list.replaceChildren();list.hidden=!q;if(!q)return;const matches=sphere.nodes.filter(n=>(n.stage+' '+n.label+' '+n.summary+' '+(n.aliases||[]).join(' ')).toLowerCase().includes(q)).slice(0,10);if(!matches.length){const p=document.createElement('p');p.textContent='没有找到相关节点';list.append(p);}for(const n of matches){const b=document.createElement('button');const small=document.createElement('small');small.textContent=n.stage+' / '+n.type;b.append(small,document.createTextNode(n.label));b.addEventListener('click',()=>{sphere.focus(n.id);list.hidden=true;$('universe-search').value='';});list.append(b);}}
  window.CosmicHome={
    init(h){if(initialized)return;initialized=true;helpers=h;sphere=new KnowledgeSphere($('universe-canvas'),selection);if(sphere.paused){$('universe-pause').textContent='▷';$('universe-pause').setAttribute('aria-label','继续知识球动画');}
      setupDialogue();const evidenceButton=document.createElement('button');evidenceButton.id='selection-evidence';evidenceButton.textContent='本轮查阅片段';evidenceButton.hidden=true;evidenceButton.addEventListener('click',()=>showEvidence(sphere.byId.get(sphere.selected)));$('universe-selection').append(evidenceButton);
      $('cosmic-form').addEventListener('submit',e=>{e.preventDefault();ask($('cosmic-question').value);});$('cosmic-question').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();ask(e.target.value);}});
      document.querySelectorAll('[data-cosmic-question]').forEach(b=>b.addEventListener('click',()=>ask(b.dataset.cosmicQuestion)));
      $('cosmic-new').addEventListener('click',()=>{if(isBusy)return;turns=[];ftaTree=null;handoff={text:'',through:0};analysisState=null;lastPacket=null;researchSet=null;externalNodes.clear();sphere.arrivals=[];integrateSources([],false);$('cosmic-feed').querySelectorAll('.cosmic-message').forEach(el=>el.remove());$('cosmic-welcome').hidden=false;activate(null);status('');$('cosmic-question').value='';$('research-query').value='';persist();setChatBusy(false);$('cosmic-question').focus();});
      $('universe-search').addEventListener('input',searchNodes);$('universe-search').addEventListener('keydown',e=>{if(e.key==='Escape')$('universe-search-results').hidden=true;if(e.key==='ArrowDown'){$('universe-search-results').querySelector('button')?.focus();e.preventDefault();}});
      $('universe-pause').addEventListener('click',togglePause);$('universe-reset').addEventListener('click',()=>sphere.reset());$('universe-selection-close').addEventListener('click',()=>sphere.select(null));$('selection-read').addEventListener('click',()=>{const node=sphere.byId.get(sphere.selected);if(node?.origin==='external')showExternal(externalNodes.get(node.id));else if(node?.article_ids?.length)helpers.openArticle(node.article_ids[0]);});
      $('activation-clear').addEventListener('click',()=>activate(null));$('inbox-open').addEventListener('click',()=>{customStatus(lastCustom);$('inbox-dialog').showModal();});$('cosmic-sync').addEventListener('click',()=>sync(true));$('inbox-sync').addEventListener('click',()=>sync(true));
      $('inbox-template').addEventListener('click',async()=>{const text='---\ntitle: 我的知识主题\nstage: 涂覆\ntags: 关键词一, 关键词二\n---\n# 我的知识主题\n\n## 概念与适用范围\n填写已整理、无内部标识的知识。\n\n## 机制与条件\n说明什么条件下成立，以及不能直接推出什么。\n\n## 验证与反证\n写出检查方法和可能反对该解释的证据。\n\n## 相关知识\n[[涂布与覆盖均匀性]]\n';try{await navigator.clipboard.writeText(text);helpers.toast('模板已复制，保存为知识投递文件夹内的 .md 文件即可。');}catch{helpers.download('知识主题模板.md',text);}});
      setInterval(()=>{if(visible&&!document.hidden)sync(false);},25000);
    },
    update({boot,universe}){articles=boot.articles;baseUniverse=universe;integrateSources([],false);customStatus(boot.custom);if(!restored){restored=true;try{if($('cosmic-remember').checked){let saved=localStorage.getItem(memoryKey);if(!saved)for(const key of legacyMemoryKeys){const candidate=localStorage.getItem(key);if(candidate){saved=candidate;break;}}if(saved&&saved!=='null'){let parsed;try{parsed=sessions.parse(saved);}catch{const legacy=JSON.parse(saved);if(Array.isArray(legacy)&&legacy.length)parsed=sessions.create(legacy);else throw new Error('旧进度格式不完整');}restoreSession(parsed);persist();}}}catch{helpers.toast('本机进度格式不完整，原存储未被覆盖。');}setChatBusy(false);}},
    setVisible(value){visible=value;if(sphere){sphere.visible=value;if(value)requestAnimationFrame(()=>sphere.resize());}},
    error(text){status('知识载入失败：'+text,true);$('activation-label').textContent='暂未连接本地知识服务';}
  };
})();
