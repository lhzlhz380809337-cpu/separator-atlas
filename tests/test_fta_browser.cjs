'use strict';
// Optional UI regression: run against a local workbench, with Playwright available.
// A fresh browser context contains only these synthetic conversations, no user settings.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const path = require('node:path');
const os = require('node:os');
const S = require('../app/web/dist/session.js');
const url = process.env.FTA_TEST_URL || 'http://127.0.0.1:8765/#home';
assert(['127.0.0.1','localhost'].includes(new URL(url).hostname), 'Only test a local server');
const turn = (question,report,key,labels=[]) => ({question,report,question_key:key,
  options:labels.map((label,i)=>({value:String.fromCharCode(65+i),label})),mode:'offline',phase:'逐步排查'});
const first=turn('基膜 CCD 发现油斑','报警位置的实物复核结果是什么？','physical',
  ['实物能确认对应斑点','实物与图像不一致或不明显','尚未做对应实物复核','部分能对应，部分不能']);
const second=turn('A','缺陷分布最明显的规律是什么？','pattern',
  ['横向位置固定，沿运行方向呈带状','沿运行方向周期性重复','某段米数集中爆发','零散分布或尚不清楚']);
let tree=S.linearFta([first,second,
  turn('B','周期性斑点的横向位置和形状是否稳定？','cross',['横向位置固定，形状相似','位置固定，形状差异明显']),
  turn('A','检出缺陷的 CCD 位于哪里？','camera',['热定型后、收卷前','分切或复卷设备上'])]);
tree=S.appendFta(tree,turn('C','能否根据报警位置找到对应实物？','trace',['能定位','还未定位']),'fta_1');
tree=S.switchFta(tree,'fta_4');
const archive=JSON.stringify(S.create([],{text:'',through:0},'',null,tree));

(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    await context.addInitScript(raw=>{localStorage.setItem('separator.dialogue.v5',raw);},archive);
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/config',route=>route.fulfill({json:{model:{base_url:'https://example.org/v1',model:'synthetic-model',protocol:'chat_completions',context_chars:16000,allow_send:true},preferences:{}}}));
    await page.route('**/api/dialogue',route=>{const payload=route.request().postDataJSON();return route.fulfill({json:{report:payload.conclude?'阶段性结论：仍需现场核查。':'异常在哪个工位开始？',mode:'model',phase:payload.conclude?'阶段性结论 · 待验证':'模型对话',turn_kind:payload.conclude?'conclusion':'dialogue',options:[],warnings:[],context:{activation:{article_ids:[],node_ids:[],edge_ids:[]},retrieved:[],related_edges:[]}}});});
    await page.goto(url);await page.locator('#fta-open').click();
    await page.locator('.fta-node[data-node-id="fta_2"]').waitFor({state:'visible'});
    assert.equal(await page.locator('#fta-detail').isVisible(),false,'Details open only on click');

    // A physical mouse click must reach the node, not be captured by the viewport.
    await page.locator('.fta-node[data-node-id="fta_2"]').click();
    await page.locator('#fta-detail[open]').waitFor({state:'visible',timeout:2000});
    assert.equal(await page.locator('#fta-detail-previous').innerText(),'报警位置的实物复核结果是什么？');
    assert.equal(await page.locator('#fta-detail-answer').innerText(),'本次选择：A · 实物能确认对应斑点');
    assert.equal(await page.locator('#fta-detail-question').innerText(),'缺陷分布最明显的规律是什么？');
    assert.equal(await page.locator('#fta-detail-options span').count(),4);
    assert.equal(await page.locator('#fta-detail-actions button').count(),3);
    const desktopShot=path.join(os.tmpdir(),'separator-fta-detail-desktop.png');
    await page.screenshot({path:desktopShot});
    console.log('Desktop detail screenshot:',desktopShot);

    // Summarize this path only, without later choices or sibling branches.
    const summaryRequest=page.waitForRequest(req=>req.url().endsWith('/api/dialogue')&&req.method()==='POST');
    await page.getByRole('button',{name:'总结此节点之前的内容',exact:true}).click();
    const summary=(await summaryRequest).postDataJSON();
    assert.deepEqual(summary.history.map(row=>row.question),[first.question,'A']);
    await page.locator('#fta-summary-title').filter({hasText:'到此节点的阶段性结论'}).waitFor();
    assert.equal(await page.locator('.fta-node').count(),5);

    // Alternative answers start from this node; previous descendants remain intact.
    await page.getByRole('button',{name:'对此问题选择另外选项',exact:true}).click();
    assert.equal(await page.locator('#fta-branch-question').innerText(),'缺陷分布最明显的规律是什么？');
    await page.locator('#fta-branch-options button').nth(2).click();
    const branchRequest=page.waitForRequest(req=>req.url().endsWith('/api/dialogue')&&req.method()==='POST');
    await page.locator('#fta-branch-submit').click();
    const branch=(await branchRequest).postDataJSON();
    assert.equal(branch.issue,'C');assert.equal(branch.branch_context.alternate,true);
    assert.deepEqual(branch.history.map(row=>row.question),[first.question,'A']);
    await page.locator('#fta-branch-dialog').waitFor({state:'hidden'});
    assert.equal(await page.locator('.fta-node').count(),6);
    assert.match(await page.locator('#fta-detail-answer').innerText(),/C · 某段米数集中爆发/);
    await page.locator('#fta-detail-close').click();

    // Deleting a node removes that subtree only; a sibling can still be analyzed.
    await page.locator('.fta-node[data-node-id="fta_2"]').click();
    await page.getByRole('button',{name:'删除此节点及后续',exact:true}).click();
    for(const id of ['fta_2','fta_3','fta_4','fta_6'])assert.match(await page.locator(`[data-node-id="${id}"]`).getAttribute('class'),/deleted/);
    assert.doesNotMatch(await page.locator('[data-node-id="fta_5"]').getAttribute('class'),/deleted/);
    await page.getByRole('button',{name:'恢复这段路径',exact:true}).click();
    for(const id of ['fta_2','fta_3','fta_4','fta_6'])assert.doesNotMatch(await page.locator(`[data-node-id="${id}"]`).getAttribute('class'),/deleted/);
    await page.locator('#fta-detail-close').click();

    // Dragging from a node pans without opening it; the very next click still works.
    const card=await page.locator('[data-node-id="fta_2"]').boundingBox();
    const before=await page.locator('#fta-stage').getAttribute('style');
    await page.mouse.move(card.x+card.width/2,card.y+card.height/2);await page.mouse.down();
    await page.mouse.move(card.x+card.width/2+65,card.y+card.height/2+45,{steps:8});await page.mouse.up();
    assert.equal(await page.locator('#fta-detail').isVisible(),false);
    assert.notEqual(await page.locator('#fta-stage').getAttribute('style'),before);
    await page.locator('[data-node-id="fta_2"]').click();
    await page.locator('#fta-detail[open]').waitFor();await page.keyboard.press('Escape');
    const zoom=await page.locator('#fta-zoom').innerText();
    const viewport=await page.locator('#fta-viewport').boundingBox();
    await page.mouse.move(viewport.x+30,viewport.y+30);await page.mouse.wheel(0,-120);
    await page.waitForFunction(old=>document.getElementById('fta-zoom').textContent!==old,zoom);
    await page.locator('#fta-maximize').click();assert.equal(await page.locator('#fta-maximize').getAttribute('aria-pressed'),'true');
    await page.locator('#fta-maximize').click();await page.locator('#fta-fit').click();

    // Compact window: details are a visible modal, never below the canvas.
    await page.setViewportSize({width:676,height:540});await page.locator('#fta-fit').click();
    await page.locator('[data-node-id="fta_2"]').click();
    const detail=await page.locator('#fta-detail').boundingBox();
    assert(detail.x>=0&&detail.y>=0&&detail.x+detail.width<=677&&detail.y+detail.height<=541);
    for(const button of await page.locator('#fta-detail-actions button').all()){
      const rect=await button.boundingBox();assert(rect.y>=0&&rect.y+rect.height<=540,'Actions remain visible');
    }
    const compactShot=path.join(os.tmpdir(),'separator-fta-detail-compact.png');
    await page.screenshot({path:compactShot});console.log('Compact detail screenshot:',compactShot);
    await page.locator('#fta-detail-content').evaluate(el=>{el.scrollTop=el.scrollHeight;});
    assert.equal(await page.locator('#fta-detail-options span').last().isVisible(),true);
    assert.deepEqual(errors,[]);

    // A broad and deep tree must fit even below the old 18% zoom floor.
    let large=S.linearFta([first]);
    for(let depth=1;depth<75;depth++)large=S.appendFta(large,turn('A','第 '+depth+' 个检查问题是什么？','',first.options.map(item=>item.label)));
    for(let branch=0;branch<32;branch++){
      large=S.switchFta(large,'fta_1');
      for(let depth=0;depth<10;depth++)large=S.appendFta(large,turn('其他来源 '+branch,'第 '+depth+' 个失效来源如何验证？','',[]));
    }
    const largeContext=await browser.newContext({viewport:{width:1440,height:1000}});
    await largeContext.addInitScript(raw=>{localStorage.setItem('separator.dialogue.v5',raw);},JSON.stringify(S.create([],{text:'',through:0},'',null,large)));
    const largePage=await largeContext.newPage();largePage.on('pageerror',error=>errors.push(error.message));
    await largePage.goto(url);await largePage.locator('#fta-open').click();await largePage.locator('#fta-fit').click();
    assert.equal(await largePage.locator('.fta-node').count(),395);
    const contained=await largePage.locator('#fta-viewport').evaluate(el=>{
      const v=el.getBoundingClientRect();return [...el.querySelectorAll('.fta-node')].every(node=>{
        const r=node.getBoundingClientRect();return r.left>=v.left&&r.right<=v.right&&r.top>=v.top&&r.bottom<=v.bottom;
      });
    });
    assert(contained,'All 395 node cards remain within the fitted canvas');
    const size=await largePage.locator('.fta-node').first().evaluate(el=>({width:el.offsetWidth,height:el.offsetHeight}));
    assert.deepEqual(size,{width:184,height:76});assert.deepEqual(errors,[]);
    console.log('FTA browser checks passed: click, parent answer, current options, summary, branching, delete/restore, pan, zoom, maximize, compact view, 395-node fit.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
