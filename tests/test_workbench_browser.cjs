'use strict';
// Synthetic end-to-end UI checks. Run with SEPARATOR_CONFIG_DIR pointing at a test directory.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const path=require('node:path');
const fs=require('node:fs');
const url=process.env.FTA_TEST_URL||'http://127.0.0.1:8766/#home';
assert(['localhost','127.0.0.1'].includes(new URL(url).hostname));
const out=path.resolve('tmp/ui-verification');fs.mkdirSync(out,{recursive:true});
const packet={activation:{article_ids:[],node_ids:[],edge_ids:[]},retrieved:[],related_edges:[],retrieval_trace:[],messages:[],total_prompt_chars:0};
const options=[{value:'A',label:'对照样也掉粉'},{value:'B',label:'对照样没有掉粉'},{value:'C',label:'尚未核查'}];
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1280,height:620},reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/dialogue',async route=>{
   const p=route.request().postDataJSON();requests.push(p);const history=p.history||[],n=history.length+1;
   const plan=p.action==='system_plan',report=plan?'当前有摩擦与涂层结合两条候选路径。\n\n## 优先行动\n\n1. 按相同位置做前后对照。\n2. 分别记录速度差与掉粉评价。\n3. 根据结果安排组合验证。':'对照样也掉粉吗？\nA．对照样也掉粉\nB．对照样没有掉粉\nC．尚未核查';
   const pending={question:'对照样也掉粉吗？',options};
   const state={version:1,initial_issue:history[0]?.question||p.issue,turn:n,facts:[{id:'f1',turn:1,text:history[0]?.question||p.issue,answer:history[0]?.question||p.issue,prompt:'',status:'reported',source:'user'}],hypotheses:[],checks:[],open_questions:[],retrieval_history:[],pending,plan_basis:{scope:['f1'],location:['f1'],comparison:[],action:['f1']},factor_relations:[]};
   await route.fulfill({json:{report,context:packet,mode:'model',phase:plan?'系统方案 · 待验证':'模型对话',turn_kind:plan?'system_plan':'dialogue',resume_pending:plan?pending:undefined,options:plan?[]:options,analysis_state:state,warnings:[],external_used:[]}});
  });
  await page.goto(url);await page.locator('#cosmic-question').waitFor();
  assert.equal(await page.locator('#cosmic-mode').count(),0);
  // Configuration is handled by the real local backend, never a remote model.
  await page.getByRole('button',{name:'模型设置',exact:true}).first().click();
  await page.locator('#base-url').fill('https://example.org/v1');await page.locator('#model-name').fill('synthetic-model');await page.locator('#api-key').fill('synthetic-ui-test-key');await page.locator('#allow-send').check();
  await page.locator('#save-settings').click();await page.locator('#connection-status').filter({hasText:'配置已保存'}).waitFor();
  const config=await page.request.get(new URL('/api/config',url).href);const cfg=await config.json();
  assert.equal(cfg.has_saved_key,true);assert(!JSON.stringify(cfg).includes('synthetic-ui-test-key'));
  await page.reload();await page.locator('#key-note').filter({hasText:'已加密保存在本机'}).waitFor();assert.equal(await page.locator('#api-key').inputValue(),'');assert.equal(await page.locator('#allow-send').isChecked(),true);
  await page.getByRole('button',{name:'返回对话',exact:true}).click();
  await page.locator('#cosmic-question').fill('涂覆膜导辊后掉粉增加，已有正常异常对照样，可以测量速度。');await page.locator('#cosmic-send').click();
  await page.locator('.reply-options button').first().waitFor();assert.match(await page.locator('#cosmic-plan').getAttribute('class'),/is-ready/);
  await page.locator('#cosmic-question').fill('尚未发送的现场补充');await page.locator('#cosmic-plan').click();
  await page.locator('.cosmic-ref-caption').filter({hasText:'系统方案'}).waitFor();assert.equal(await page.locator('#cosmic-question').inputValue(),'尚未发送的现场补充');
  await page.locator('#cosmic-feed .reply-options').last().getByRole('button',{name:'B · 对照样没有掉粉',exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('separator.dialogue.v6')).fta.nodes.length===3);
  assert.equal(requests.at(-1).history[1].turn_kind,'system_plan');assert.equal(requests.at(-1).issue,'B');
  const pair=await page.locator('.plan-tools button').allTextContents();assert.deepEqual(pair,['分析材料','生成系统方案']);
  // Grow chat beyond the previous 68% cap and restore with the keyboard.
  const bar=await page.locator('#chat-resizer').boundingBox();await page.mouse.move(bar.x+bar.width/2,bar.y+100);await page.mouse.down();await page.mouse.move(35,bar.y+100,{steps:12});await page.mouse.up();
  assert(Number(await page.locator('#chat-resizer').getAttribute('aria-valuenow'))>90);
  const geometry=await page.evaluate(()=>{const c=document.querySelector('.cosmic-chat').getBoundingClientRect(),s=document.querySelector('.universe-scene').getBoundingClientRect();return {chatLeft:c.left,sceneRight:s.right};});assert(geometry.chatLeft<geometry.sceneRight,'Chat overlaps the sphere');
  await page.locator('#chat-resizer').focus();await page.keyboard.press('Home');
  // Single-line composer keeps pasted content and IME Enter never submits it.
  const long='现场补充内容'.repeat(180)+'\n第二行';await page.locator('#cosmic-question').fill(long);
  const input=await page.locator('#cosmic-question').boundingBox();assert(input.height<=36);assert.equal(await page.locator('#cosmic-question').inputValue(),long);
  const count=requests.length;await page.locator('#cosmic-question').dispatchEvent('keydown',{key:'Enter',isComposing:true});assert.equal(requests.length,count);
  await page.locator('#cosmic-question').fill('保存这条草稿');
  // Dark theme and reading sizes retain a useful reply area at small viewports.
  const metrics=[];
  for(const theme of ['dark']){
   await page.evaluate(t=>window.WorkbenchPreferences.apply({theme:t}),theme);
   for(const [width,height] of [[1536,760],[1280,620],[1093,560],[1024,500],[800,450]]){
    await page.setViewportSize({width,height});
    for(const font_size of [16,18,20]){
     await page.evaluate(n=>window.WorkbenchPreferences.apply({font_size:n}),font_size);
     const boxes=await page.evaluate(()=>{const box=id=>{const r=document.getElementById(id).getBoundingClientRect();return {height:r.height,bottom:r.bottom,left:r.left,right:r.right};};return {credit:document.querySelector('.cosmos-credit span').getBoundingClientRect().bottom,feed:box('cosmic-feed'),input:box('cosmic-question'),send:box('cosmic-send'),pageHeight:document.documentElement.scrollHeight};});
     assert(boxes.feed.height>=height-270,JSON.stringify({width,height,font_size,theme,boxes}));assert(boxes.credit<=height-5);assert(boxes.input.bottom<=height);assert(boxes.send.bottom<=height);assert(boxes.pageHeight<=height+1);metrics.push({theme,width,height,font_size,replyHeight:boxes.feed.height});
    }
   }
   await page.setViewportSize({width:1280,height:620});await page.screenshot({path:path.join(out,theme+'-chat.png')});
   for(const view of ['graph','library','settings']){await page.getByRole('button',{name:{graph:'知识图谱',library:'知识库',settings:'模型设置'}[view],exact:true}).first().click();await page.screenshot({path:path.join(out,theme+'-'+view+'.png')});}
   await page.getByRole('button',{name:'知识星图',exact:true}).first().click();await page.locator('#fta-open').click();await page.locator('.fta-node').first().click();await page.screenshot({path:path.join(out,theme+'-fta.png')});await page.locator('#fta-detail-close').click();await page.locator('#fta-dialog .close-dialog').first().click();
  }
  await page.locator('.chat-more summary').click();await page.locator('#reading-size').selectOption('18');await page.waitForResponse(r=>r.url().endsWith('/api/config')&&r.request().method()==='POST');
  await page.reload();await page.locator('#fta-open:not([disabled])').waitFor();assert.equal(await page.locator('#reading-size').inputValue(),'18');
  assert.equal(await page.locator('#theme-toggle').count(),0);assert.equal(await page.locator('#cosmic-mode-label').count(),0);
  assert.equal(await page.locator('.cosmic-ref-caption').filter({hasText:'系统方案'}).count(),1);
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'metrics.json'),JSON.stringify(metrics,null,2));
  console.log('UI checks passed: API save/reload, plan/resume, layout, overlap, IME, 15 viewport/font combinations, reading preference persistence, FTA.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
