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
  function scrollFeed(){const feed=$('cosmic-feed'),last=feed.querySelector('.cosmic-message.assistant:last-child');feed.scrollTop=last?feed.scrollTop+last.getBoundingClientRect().top-feed.getBoundingClientRect().top-8:feed.scrollHeight;}
  function addMessage(role,body){const el=document.createElement('article');el.className='cosmic-message '+role;el.innerHTML=`<div class="message-meta">${role==='user'?'你':'<span>✦</span> 隔膜研析'}</div><div class="message-body">${body}</div>`;$('cosmic-feed').append(el);return el;}
  function status(text,error=false){$('cosmic-chat-status').textContent=text;$('cosmic-chat-status').classList.toggle('error',error);}
  let lastPacket=null, displayedContext=null, analysisState=null, researchSet=null, externalNodes=new Map(), baseUniverse=null, restored=false;
  const sessions=window.SeparatorSession, memoryKey='separator.dialogue.v4', legacyMemoryKey='separator.dialogue.v3';
  let handoff={text:'',through:0}, pendingSession=null;
  function currentSession(){return sessions.create(turns,handoff,$('cosmic-question').value,analysisState);}
  function persist(){if(!$('cosmic-remember').checked)return;try{localStorage.setItem(memoryKey,turns.length?JSON.stringify(currentSession()):'null');localStorage.removeItem(legacyMemoryKey);}catch{helpers.toast('本机记录未能保存，请用“保存进度”下载备份。');}}
  function setChatBusy(value){isBusy=value;sphere.busy=value;for(const id of ['cosmic-send','cosmic-new','research-run','cosmic-load','session-download','session-summarize','session-confirm-load','session-backup'])$(id).disabled=value;for(const id of ['cosmic-conclude','cosmic-export','cosmic-save'])$(id).disabled=value||!turns.length;$('session-notes').disabled=value;$('session-compact').disabled=value;$('cosmic-packet').disabled=value||!lastPacket;document.querySelectorAll('.reply-options button').forEach(b=>b.disabled=value||Number(b.dataset.turn)!==turns.length-1);}
  function showExternal(source){$('reader-stage').textContent='外部检索 · 待核验';$('reader-title').textContent=source.title;$('reader-content').innerHTML=helpers.markdown(`检索时间：${source.retrieved_at}\n\n${source.status}\n\n${source.excerpt}\n\n[查看原始网页](${source.url})`);if(!$('reader-dialog').open)$('reader-dialog').showModal();}
  function integrateSources(sources,animate=true){const added=[];for(const s of sources||[]){if(!externalNodes.has(s.id))added.push(s.id);externalNodes.set(s.id,s);}if(baseUniverse){const nodes=[...baseUniverse.nodes,...[...externalNodes.values()].map(s=>({id:s.id,label:s.title,stage:'外部',type:'待核验资料',kind:'external',origin:'external',summary:s.status,article_ids:[]}))];const edges=[...baseUniverse.edges];for(const s of externalNodes.values())for(const target of s.anchor_ids||[])if(baseUniverse.nodes.some(n=>n.id===target))edges.push({id:'research:'+s.id+':'+target,source:s.id,target,kind:'external',relation:'同次检索的参考资料，不代表因果'});sphere.setData({nodes,edges});$('universe-node-count').textContent=nodes.length;$('universe-edge-count').textContent=edges.length;if(animate)for(const id of added)sphere.arrive(id);}}
  function renderTurn(turn,index){addMessage('user',helpers.escapeHTML(turn.question));const optionLines=new Set((turn.options||[]).map(o=>o.value+'．'+o.label));const display=turn.report.split('\n').filter(line=>!optionLines.has(line)).join('\n');const el=addMessage('assistant',`<div class="markdown">${helpers.markdown(display)}</div>`);const relight=document.createElement('button');relight.className='activate-turn';relight.textContent='点亮本轮依据';relight.addEventListener('click',()=>{activate(turn.context);for(const id of turn.external_used||[])sphere.activeNodes.add(id);});el.querySelector('.message-meta').append(relight);
    if(turn.options?.length){const choices=document.createElement('div');choices.className='reply-options';for(const o of turn.options){const b=document.createElement('button');b.textContent=o.value+' · '+o.label;b.dataset.turn=index;b.addEventListener('click',()=>{if(index===turns.length-1)ask(o.value);});choices.append(b);}el.append(choices);}
    const caption=document.createElement('div');caption.className='cosmic-ref-caption';caption.textContent=(turn.phase||'分析草案')+' · '+(turn.mode==='model'?'模型对话':'本地引导 · 未调用模型');el.append(caption);
    const refs=document.createElement('div');refs.className='cosmic-refs';for(const id of turn.context?.activation?.article_ids||[]){const a=articles.find(a=>a.id===id);if(!a)continue;const b=document.createElement('button');b.textContent=a.title;b.addEventListener('click',()=>{sphere.focus('doc:'+id);helpers.openArticle(id);});refs.append(b);}for(const s of turn.sources||[]){const b=document.createElement('button');b.className='external-ref';b.textContent='↗ '+s.title;b.addEventListener('click',()=>{sphere.focus(s.id);showExternal(s);});refs.append(b);}const evidence=document.createElement('details');const evidenceTitle=document.createElement('summary');evidenceTitle.textContent=`本轮知识依据 · ${turn.context?.activation?.article_ids?.length||0} 篇本地 · ${turn.sources?.length||0} 条外部`;evidence.append(evidenceTitle,refs);el.append(evidence);for(const warning of turn.warnings||[]){const p=document.createElement('p');p.className='cosmic-warning';p.textContent=warning;el.append(p);}return el;
  }
  function publicQuery(issue){if(/油斑|油点/.test(issue))return 'wet process polyethylene battery separator oil spots roller contamination extraction';if(/涂覆|陶瓷/.test(issue))return 'lithium ion battery ceramic coated separator permeability coating defects';if(/收缩/.test(issue))return 'polyethylene battery separator thermal shrinkage pore structure';return 'lithium ion battery separator manufacturing quality defect mechanisms';}
  async function fetchResearch(){const query=$('research-query').value.trim();if(!$('cosmic-web').checked){helpers.toast('请先开启联网补充，并检查公开检索词。');return null;}status('正在检索公开资料…');const data=await helpers.api('/api/research',{query,search_key:$('search-key').value,allow_search:true});researchSet={...data,received:Date.now()};const anchors=(lastPacket?.activation.node_ids||[]).slice(0,2);data.sources=data.sources.map(s=>({...s,anchor_ids:anchors}));researchSet.sources=data.sources;integrateSources(data.sources);$('research-label').textContent=data.sources.length?`外部知识 · 已取得 ${data.sources.length} 条待核验资料`:'外部知识 · 本次没有有效结果';status(data.sources.length?'公开资料已进入本次分析星图，适用性待核验。':'未取得有效外部摘录，没有新增节点。');return data;}
  async function ask(question,conclude=false){
    if(isBusy||!question.trim())return;question=question.trim();const mode=$('cosmic-mode').value;
    if(turns.length>=500){helpers.toast('当前进度已达 500 轮，请保存后为新的问题开启对话。');return;}
    let continuation={history:[]};
    try{if(turns.length)continuation=sessions.input(currentSession());}catch(err){openSave();helpers.toast(err.message);return;}
    if(mode!=='model'&&handoff.through){helpers.toast('这份长对话已分段，请切换“模型对话”接着分析。');return;}
    if(mode==='model'&&(!$('base-url').value.trim()||!$('model-name').value.trim()||!$('allow-send').checked)){helpers.switchView('settings');helpers.toast('请先配置模型，并确认可以发送当前问题与知识。');return;}
    setChatBusy(true);$('cosmic-welcome').hidden=true;$('cosmic-question').value='';const user=addMessage('user',helpers.escapeHTML(question));const pending=addMessage('assistant','<div class="pending-dots" aria-label="正在分析"><i></i><i></i><i></i></div>');scrollFeed();status('正在结合已有问答检索知识…');
    if(!$('research-query').value.trim())$('research-query').value=publicQuery(turns[0]?.question||question);
    try{
      if($('cosmic-web').checked&&(!researchSet||researchSet.query!==$('research-query').value.trim()||Date.now()-researchSet.received>1500000)){try{await fetchResearch();}catch(err){researchSet=null;helpers.toast(err.message);$('research-label').textContent='外部知识 · 检索未完成';}}
      const payload={issue:question,mode,...continuation,conclude,context_chars:Number($('context-budget').value),allow_custom:$('model-custom').checked,research_id:$('cosmic-web').checked?researchSet?.research_id||'':''};
      if(mode==='model')Object.assign(payload,{settings:helpers.modelSettings(),allow_send:true});
      status(mode==='model'?'正在结合对话进度分析…':'正在整理下一问与验证方向…');
      const data=await helpers.api('/api/dialogue',payload);lastPacket=data.context;activate(data.context);for(const id of data.external_used||[])sphere.activeNodes.add(id);
      const sourceList=$('cosmic-web').checked?researchSet?.sources||[]:[];for(const s of sourceList)if(!s.anchor_ids?.length)s.anchor_ids=(data.context.activation.node_ids||[]).slice(0,2);integrateSources(sourceList,false);
      const turn={question,report:data.report,context:data.context,mode,question_key:data.question_key,options:data.options,phase:data.phase,external_used:data.external_used||[],sources:sourceList,warnings:data.warnings};const clean=sessions.create([...turns,turn],handoff,'',data.analysis_state||null);analysisState=clean.analysis_state;turns=clean.turns;user.remove();pending.remove();renderTurn(turns.at(-1),turns.length-1);persist();$('cosmic-mode-label').textContent=mode==='model'?data.model+' · 对话分析':'本地引导 · 逐步排查';status(data.phase==='逐步排查'?'选择一个回答，或直接输入补充和修正。':'可继续补充证据，也可整理当前结论。');scrollFeed();
    }catch(err){pending.querySelector('.message-body').innerHTML='<p class="message-error">'+helpers.escapeHTML(err.message)+'</p>';status('本轮未完成，已有分析记录仍保留。',true);$('cosmic-question').value=question;scrollFeed();}
    finally{setChatBusy(false);}
  }
  function saveFile(session){helpers.download('隔膜分析进度-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(session,null,2),'application/json;charset=utf-8');}
  function openSave(){
    if(isBusy||!turns.length)return;
    $('session-save-info').textContent=`保存全部 ${turns.length} 轮问答、现场陈述与更正、候选与检查记录、查阅片段和未发送草稿。`;
    $('session-notes').value=handoff.text;$('session-compact').checked=false;$('session-summary-status').textContent='';
    if(!$('session-save-dialog').open)$('session-save-dialog').showModal();
  }
  function editedSession(){
    const notes=$('session-notes').value;
    const through=$('session-compact').checked?Math.max(0,turns.length-1):handoff.through;
    if($('session-compact').checked&&!notes.trim())throw new Error('请先填写或整理交接记录，核对后再采用。');
    return sessions.create(turns,{text:notes,through},$('cosmic-question').value,analysisState);
  }
  function restoreSession(value){
    const clean=sessions.normalize(value);
    turns=clean.turns;handoff=clean.handoff;analysisState=clean.analysis_state;lastPacket=null;researchSet=null;externalNodes.clear();sphere.arrivals=[];
    integrateSources([],false);$('cosmic-feed').querySelectorAll('.cosmic-message').forEach(el=>el.remove());$('cosmic-welcome').hidden=true;
    turns.forEach((t,i)=>{integrateSources(t.sources,false);renderTurn(t,i);});activate(turns.at(-1).context);
    $('cosmic-question').value=clean.draft;$('research-query').value='';$('cosmic-web').checked=false;
    $('research-label').textContent=externalNodes.size?'外部知识 · 历史摘录，需重新检索':'外部知识 · 未开启';
    status(`已恢复 ${turns.length} 轮问答。${handoff.through?'后续使用交接记录与本段问答，请选择模型对话。':'可直接回答最后的问题，或补充新的检查结果。'}`);
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
    $('session-download').addEventListener('click',()=>{try{const session=editedSession();saveFile(session);handoff=session.handoff;persist();$('session-save-dialog').close();status('已生成进度文件。下次可载入接着聊，也可交给其他工程师。');}catch(err){helpers.toast(err.message);}});
    $('cosmic-export').addEventListener('click',()=>{try{helpers.download('隔膜问题对话.md',sessions.markdown(editedSession()));}catch(err){helpers.toast(err.message);}});
    $('cosmic-load').addEventListener('click',()=>{if(!isBusy)$('session-file').click();});
    $('session-file').addEventListener('change',async()=>{
      const file=$('session-file').files[0];$('session-file').value='';if(!file||isBusy)return;pendingSession=null;setChatBusy(true);
      try{
        if(file.size>sessions.MAX_BYTES)throw new Error('请选择不超过 5 MB 的进度文件。');
        pendingSession=sessions.parse(await file.text());
        $('session-load-title').textContent=pendingSession.title;
        $('session-load-info').textContent=`${pendingSession.turns.length} 轮问答 · 保存时间：${pendingSession.saved_at||'未记录'}`;
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
    $('cosmic-conclude').addEventListener('click',()=>ask('请根据目前的问答整理阶段性结论和下一步验证任务。',true));
    $('cosmic-packet').addEventListener('click',()=>{if(lastPacket)helpers.showPacket(lastPacket);});
    $('cosmic-remember').addEventListener('change',()=>{try{if(!$('cosmic-remember').checked){localStorage.removeItem(memoryKey);localStorage.removeItem(legacyMemoryKey);}else persist();localStorage.setItem('separator.remember',$('cosmic-remember').checked?'yes':'no');}catch{helpers.toast('浏览器未允许保存本机记忆。');}});
    $('cosmic-web').addEventListener('change',()=>{$('research-label').textContent=$('cosmic-web').checked?'外部知识 · 联网补充已开启':'外部知识 · 未开启';});
    $('research-run').addEventListener('click',async()=>{if(isBusy)return;setChatBusy(true);try{await fetchResearch();}catch(err){researchSet=null;status(err.message,true);$('research-label').textContent='外部知识 · 检索未完成';}finally{setChatBusy(false);}});
    const resizer=$('chat-resizer'),workspace=document.querySelector('.cosmos-workspace');let dragging=false;
    function width(value){const ratio=clamp(Number.isFinite(value)?value:45,32,68);workspace.style.setProperty('--chat-width',ratio+'%');resizer.setAttribute('aria-valuenow',Math.round(ratio));try{localStorage.setItem('separator.chat-width',ratio);}catch{}sphere.resize();}
    try{width(Number(localStorage.getItem('separator.chat-width')||45));$('cosmic-remember').checked=localStorage.getItem('separator.remember')!=='no';}catch{}
    resizer.addEventListener('pointerdown',e=>{dragging=true;resizer.setPointerCapture(e.pointerId);document.body.classList.add('resizing-chat');});resizer.addEventListener('pointermove',e=>{if(!dragging)return;const r=workspace.getBoundingClientRect();width((r.right-e.clientX)/r.width*100);});const release=()=>{dragging=false;document.body.classList.remove('resizing-chat');};resizer.addEventListener('pointerup',release);resizer.addEventListener('pointercancel',release);resizer.addEventListener('lostpointercapture',release);resizer.addEventListener('dblclick',()=>width(45));resizer.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home'].includes(e.key)){e.preventDefault();width(e.key==='Home'?45:Number(resizer.getAttribute('aria-valuenow'))+(e.key==='ArrowLeft'?2:-2));}});
  }

  function customStatus(custom){lastCustom=custom||{loaded:0,issues:[]};$('cosmic-sync-label').textContent=`自建知识 ${lastCustom.loaded} 篇`;const s=$('inbox-status');s.textContent=`已载入 ${lastCustom.loaded} 篇自建知识。星图打开时每 25 秒检查一次变化。`;if(lastCustom.issues?.length){const ul=document.createElement('ul');for(const item of lastCustom.issues){const li=document.createElement('li');li.textContent=item.reason+'（条目标识 '+item.id.slice(-6)+'）';ul.append(li);}s.append(ul);}}
  async function sync(manual=false){if(syncing||isBusy)return;syncing=true;$('cosmic-sync').disabled=true;$('inbox-sync').disabled=true;try{const data=await helpers.api('/api/custom/sync',{force:manual});customStatus(data.custom);if(data.changed){await helpers.loadAll();if(data.custom.issues.length)helpers.toast('同步完成，有条目需要按扩充知识窗口的提示调整。');else helpers.toast(`知识已更新：${data.custom.loaded} 篇自建知识`);}else if(manual)helpers.toast('知识已同步，当前没有新变化。');}catch(err){if(manual)helpers.toast(err.message);}finally{syncing=false;$('cosmic-sync').disabled=false;$('inbox-sync').disabled=false;}}
  function searchNodes(){const q=$('universe-search').value.trim().toLowerCase();const list=$('universe-search-results');list.replaceChildren();list.hidden=!q;if(!q)return;const matches=sphere.nodes.filter(n=>(n.stage+' '+n.label+' '+n.summary+' '+(n.aliases||[]).join(' ')).toLowerCase().includes(q)).slice(0,10);if(!matches.length){const p=document.createElement('p');p.textContent='没有找到相关节点';list.append(p);}for(const n of matches){const b=document.createElement('button');const small=document.createElement('small');small.textContent=n.stage+' / '+n.type;b.append(small,document.createTextNode(n.label));b.addEventListener('click',()=>{sphere.focus(n.id);list.hidden=true;$('universe-search').value='';});list.append(b);}}
  window.CosmicHome={
    init(h){if(initialized)return;initialized=true;helpers=h;sphere=new KnowledgeSphere($('universe-canvas'),selection);if(sphere.paused){$('universe-pause').textContent='▷';$('universe-pause').setAttribute('aria-label','继续知识球动画');}
      setupDialogue();const evidenceButton=document.createElement('button');evidenceButton.id='selection-evidence';evidenceButton.textContent='本轮查阅片段';evidenceButton.hidden=true;evidenceButton.addEventListener('click',()=>showEvidence(sphere.byId.get(sphere.selected)));$('universe-selection').append(evidenceButton);
      $('cosmic-form').addEventListener('submit',e=>{e.preventDefault();ask($('cosmic-question').value);});$('cosmic-question').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();ask(e.target.value);}});
      document.querySelectorAll('[data-cosmic-question]').forEach(b=>b.addEventListener('click',()=>ask(b.dataset.cosmicQuestion)));
      $('cosmic-new').addEventListener('click',()=>{if(isBusy)return;turns=[];handoff={text:'',through:0};analysisState=null;lastPacket=null;researchSet=null;externalNodes.clear();sphere.arrivals=[];integrateSources([],false);$('cosmic-feed').querySelectorAll('.cosmic-message').forEach(el=>el.remove());$('cosmic-welcome').hidden=false;activate(null);status('');$('cosmic-question').value='';$('research-query').value='';persist();setChatBusy(false);$('cosmic-question').focus();});
      $('cosmic-mode').addEventListener('change',()=>{$('cosmic-mode-label').textContent=$('cosmic-mode').value==='model'?'模型分析 · 使用配置的服务':'本地知识已连接';});
      $('universe-search').addEventListener('input',searchNodes);$('universe-search').addEventListener('keydown',e=>{if(e.key==='Escape')$('universe-search-results').hidden=true;if(e.key==='ArrowDown'){$('universe-search-results').querySelector('button')?.focus();e.preventDefault();}});
      $('universe-pause').addEventListener('click',togglePause);$('universe-reset').addEventListener('click',()=>sphere.reset());$('universe-selection-close').addEventListener('click',()=>sphere.select(null));$('selection-read').addEventListener('click',()=>{const node=sphere.byId.get(sphere.selected);if(node?.origin==='external')showExternal(externalNodes.get(node.id));else if(node?.article_ids?.length)helpers.openArticle(node.article_ids[0]);});
      $('activation-clear').addEventListener('click',()=>activate(null));$('inbox-open').addEventListener('click',()=>{customStatus(lastCustom);$('inbox-dialog').showModal();});$('cosmic-sync').addEventListener('click',()=>sync(true));$('inbox-sync').addEventListener('click',()=>sync(true));
      $('inbox-template').addEventListener('click',async()=>{const text='---\ntitle: 我的知识主题\nstage: 涂覆\ntags: 关键词一, 关键词二\n---\n# 我的知识主题\n\n## 概念与适用范围\n填写已整理、无内部标识的知识。\n\n## 机制与条件\n说明什么条件下成立，以及不能直接推出什么。\n\n## 验证与反证\n写出检查方法和可能反对该解释的证据。\n\n## 相关知识\n[[涂布与覆盖均匀性]]\n';try{await navigator.clipboard.writeText(text);helpers.toast('模板已复制，保存为知识投递文件夹内的 .md 文件即可。');}catch{helpers.download('知识主题模板.md',text);}});
      setInterval(()=>{if(visible&&!document.hidden)sync(false);},25000);
    },
    update({boot,universe}){articles=boot.articles;baseUniverse=universe;integrateSources([],false);customStatus(boot.custom);if(!restored){restored=true;try{if($('cosmic-remember').checked){const saved=localStorage.getItem(memoryKey);if(saved&&saved!=='null')restoreSession(sessions.parse(saved));else if(saved===null){const legacy=JSON.parse(localStorage.getItem(legacyMemoryKey)||'[]');if(Array.isArray(legacy)&&legacy.length){restoreSession(sessions.create(legacy));persist();}}}}catch{helpers.toast('本机进度格式不完整，原存储未被覆盖。');}setChatBusy(false);}},
    setVisible(value){visible=value;if(sphere){sphere.visible=value;if(value)requestAnimationFrame(()=>sphere.resize());}},
    error(text){status('知识载入失败：'+text,true);$('activation-label').textContent='暂未连接本地知识服务';}
  };
})();
