import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from app.core import KnowledgeStore
from app.dialogue import respond
from app.analysis_state import advance, apply_plan, normalize_state, options_from, retrieval_focus
from app.providers import ProviderError


class DynamicDialogueTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.store=KnowledgeStore()

    def test_choices_become_observations_and_latest_evidence_drives_search(self):
        history=[];state=None
        for q in ['CCD 发现基膜油斑','A','B']:
            result=respond(self.store,{'issue':q,'history':history,'analysis_state':state})
            state=result['analysis_state']
            history.append(dict(question=q,report=result['report'],question_key=result['question_key'],options=result['options']))
        self.assertIn('沿运行方向周期性重复',state['facts'][-1]['answer'])
        self.assertIn('周期性重复',result['context']['retrieval_trace'][0]['query'])
        self.assertNotEqual(result['context']['retrieval_trace'][0]['query'],'CCD 发现基膜油斑')
        self.assertIn('周期性',json.dumps(result['context']['retrieved'],ensure_ascii=False))

    def test_correction_supersedes_old_report_and_does_not_reappear_as_support(self):
        history=[{'question':'CCD 油斑','report':'分布如何？\nA．固定间距重复\nB．零散分布','options':[]},
                 {'question':'A','report':'已核对辊周长吗？'}]
        state=advance({},history,'CCD 油斑','更正：间距不固定，之前说错了')
        old=next(f for f in state['facts'] if f['id']=='f2')
        self.assertEqual(old['status'],'superseded')
        self.assertEqual(old['superseded_by'],'f3')
        self.assertNotIn('固定间距重复',retrieval_focus(state))
        state=apply_plan(state,{'hypotheses':[{'id':'roller','text':'辊面印迹候选','support':['f2'],'against':[],'status':'candidate'}]})
        self.assertEqual(state['hypotheses'][0]['support'],[])

    def test_plan_supplements_knowledge_then_final_answer_uses_new_material(self):
        plan={'queries':[{'query':'辊周长 重复间距 接触印迹','reason':'核对周期性缺陷的接触转移条件'}],
              'hypotheses':[{'id':'contact','text':'接触转移待验证','support':[],'against':[],'status':'candidate'}],
              'open_questions':['重复间距是否已测量？']}
        with patch('app.dialogue.call_model',side_effect=[{'report':json.dumps(plan,ensure_ascii=False),'usage':{'prompt_tokens':10}},
                {'report':'重复间距测量过吗？','warnings':[]}]) as call:
            r=respond(self.store,{'issue':'基膜油斑呈固定间距重复','mode':'model','allow_send':True})
        self.assertEqual(call.call_count,2)
        self.assertTrue(any(t['kind']=='supplement' and t['article_ids'] for t in r['context']['retrieval_trace']))
        self.assertIn('核对周期性缺陷',call.call_args[0][1][-1]['content'])
        self.assertEqual(r['analysis_state']['pending']['question'],'重复间距测量过吗？')
        self.assertEqual(r['retrieval_usage'],{'prompt_tokens':10})

    def test_malformed_overbroad_and_invented_plans_fall_back_without_execution(self):
        invalid=['普通答案不是 JSON',json.dumps({'queries':[{'query':'x','reason':'y'}]*3}),
                 json.dumps({'hypotheses':[{'id':'x','text':'已确认','support':['fabricated'],'against':[],'status':'candidate'}]})]
        for report in invalid:
            with self.subTest(report=report),patch('app.dialogue.call_model',side_effect=[{'report':report},{'report':'先核对实物。'}]):
                r=respond(self.store,{'issue':'CCD 油斑','mode':'model','allow_send':True})
                self.assertTrue(r['warnings'])
                self.assertFalse(any(t['kind']=='supplement' for t in r['context']['retrieval_trace']))
                self.assertEqual(r['analysis_state']['hypotheses'],[])

    def test_unknown_cannot_become_completed_check_or_root_cause(self):
        state=advance({},[{'question':'油斑','report':'检查了吗？\nA．已检查\nB．尚未检查'}],'油斑','B')
        self.assertEqual(state['facts'][-1]['status'],'unknown')
        result=apply_plan(state,{'checks':[{'text':'模型误写已检查','fact_ids':['f2']}],
                                 'hypotheses':[{'id':'h','text':'候选','support':['f2'],'against':[],'status':'candidate'}]})
        self.assertEqual(result['checks'],[])
        self.assertEqual(result['hypotheses'][0]['support'],[])
        with self.assertRaises(ValueError):
            apply_plan(state,{'hypotheses':[{'id':'h','text':'根因','status':'confirmed'}]})

    def test_resume_keeps_original_state_and_resolves_last_options(self):
        history=[];state=None
        for q in ['CCD 油斑','A','B']:
            r=respond(self.store,{'issue':q,'history':history,'analysis_state':state})
            state=r['analysis_state'];history.append({'question':q,'report':r['report'],'options':r['options'],'question_key':r['question_key']})
        payload={'issue':'A','history':history[-1:],'analysis_state':state,'mode':'model','allow_send':True,
                 'handoff':{'initial_issue':'CCD 油斑','notes':'实物能对应；报告有周期性，原因尚未确认。','archived_turns':2}}
        with patch('app.dialogue.call_model',side_effect=[{'report':'{"queries":[]}'},{'report':'接下来核对 CCD 的位置。'}]):
            resumed=respond(self.store,payload)
        self.assertEqual(resumed['analysis_state']['turn'],4)
        self.assertEqual(resumed['analysis_state']['facts'][:3],state['facts'])
        self.assertEqual(resumed['analysis_state']['facts'][-1]['answer'],'横向位置固定，形状相似')
        self.assertEqual(resumed['context']['issue'],'CCD 油斑')

    def test_injected_state_or_options_blocked_before_any_model_call(self):
        state=advance({},[],'油斑','油斑')
        state['open_questions']=['客户代号：SYNTHETIC_ONLY']
        with patch('app.dialogue.call_model') as call:
            with self.assertRaises(ValueError):
                respond(self.store,{'issue':'继续','history':[{'question':'油斑','report':'待核对'}],
                        'analysis_state':state,'mode':'model','allow_send':True})
            with self.assertRaises(ValueError):
                respond(self.store,{'issue':'继续','history':[{'question':'油斑','report':'待核对',
                    'options':[{'value':'A','label':'客户代号：SYNTHETIC_ONLY'}]}],'mode':'model','allow_send':True})
            call.assert_not_called()

    def test_options_markdown_unknown_letter_and_wrong_state_rejected(self):
        self.assertEqual(options_from(report='检查结果？\n**A.** 已检查\n**B.** 未检查')[1]['label'],'未检查')
        state=advance({},[{'question':'油斑','report':'没有给选项'}],'油斑','C')
        self.assertEqual(state['facts'][-1]['status'],'unknown')
        self.assertIn('含义未能对应',state['facts'][-1]['answer'])
        with self.assertRaises(ValueError):
            advance({'analysis_state':state},[],'另一个问题','另一个问题')

    def test_not_performed_variants_are_not_completed_checks_but_negative_result_is_retained(self):
        history=[{'question':'油斑','report':'检查结果是什么？'}]
        for answer in ('没有检查','没检查','未测量','暂未确认','还没有比较连续图像','准备去核对'):
            with self.subTest(answer=answer):
                state=advance({},history,'油斑',answer)
                self.assertEqual(state['facts'][-1]['status'],'unknown')
                result=apply_plan(state,{'checks':[{'text':'错误地称已完成检查','fact_ids':['f2']}]})
                self.assertEqual(result['checks'],[])
        state=advance({},history,'油斑','已经检查，未发现异常')
        self.assertEqual(state['facts'][-1]['status'],'reported')
        self.assertEqual(len(apply_plan(state,{'checks':[{'text':'已检查，未见异常','fact_ids':['f2']} ]})['checks']),1)

    def test_planning_timeout_falls_back_to_initial_context(self):
        with patch('app.dialogue.call_model',side_effect=[ProviderError('synthetic timeout'),{'report':'先核对实物是否对应。'}]) as call:
            r=respond(self.store,{'issue':'CCD 油斑','mode':'model','allow_send':True})
        self.assertEqual(call.call_count,2)
        self.assertIn('补查请求未完成',r['warnings'][0])
        self.assertFalse(any(t['kind']=='supplement' for t in r['context']['retrieval_trace']))

    def test_private_custom_heading_blocked_before_planning(self):
        from copy import deepcopy
        store=deepcopy(self.store)
        for a in store.articles:
            a['origin']='user'
        for c in store.chunks:
            c['heading']='客户代号：SYNTHETIC_ONLY'
        with patch('app.dialogue.call_model') as call:
            with self.assertRaises(ValueError):
                respond(store,{'issue':'油斑','mode':'model','allow_send':True,'allow_custom':True})
            call.assert_not_called()

    def test_compact_and_parenthesized_options_resolve_without_merging(self):
        reports=['实物复核了吗？A. 已复核；B. 未复核。','实物复核了吗？\nA．已复核 B．未复核',
                 '实物复核了吗？\n(A) 已复核\n(B) 未复核','实物复核了吗？\n**A.** 已复核\n**B.** 未复核']
        for report in reports:
            with self.subTest(report=report):
                opts=options_from(report=report)
                self.assertEqual([o['value'] for o in opts],['A','B'])
                self.assertNotIn('未复核',opts[0]['label'])
                yes=advance({},[{'question':'油斑','report':report}],'油斑','A')
                no=advance({},[{'question':'油斑','report':report}],'油斑','B')
                self.assertEqual(yes['facts'][-1]['status'],'reported')
                self.assertEqual(no['facts'][-1]['status'],'unknown')
                self.assertEqual(yes['facts'][-1]['prompt'],'实物复核了吗？')

    def test_guesses_are_not_outcomes_and_mixed_statement_preserves_actual_observation(self):
        for answer in ('如果检查发现油污，先清理辊面','我猜测实物能对应斑点','假设检测已确认残油偏高'):
            with self.subTest(answer=answer):
                state=advance({},[{'question':'油斑','report':'检查结果是什么？'}],'油斑',answer)
                self.assertEqual(state['facts'][-1]['status'],'unknown')
                updated=apply_plan(state,{'checks':[{'text':'检查已完成','fact_ids':['f2']}],
                    'hypotheses':[{'id':'h','text':'假设','support':['f2'],'against':[],'status':'candidate'}]})
                self.assertEqual(updated['checks'],[])
                self.assertEqual(updated['hypotheses'][0]['support'],[])
        answer='检查过，未发现异常，可能是其他位置的问题'
        state=advance({},[{'question':'油斑','report':'检查结果是什么？'}],'油斑',answer)
        self.assertEqual(state['facts'][-1]['status'],'reported')
        self.assertEqual(state['facts'][-1]['answer'],answer)
        self.assertNotIn('可能',state['facts'][-1]['text'])
        self.assertIn('未发现异常',state['facts'][-1]['text'])


class GraphExpansionTests(unittest.TestCase):
    def make_store(self,root):
        directory=root/'knowledge'/'base';directory.mkdir(parents=True)
        articles=[]
        for aid,title,content in [('a','Alpha seed','alpha symptom baseline'),('b','Neutral topic','unrelated zzz material marker'),('c','Omega verification','omega check condition marker')]:
            (directory/(aid+'.md')).write_text('# '+title+'\n\n'+content,encoding='utf-8')
            articles.append({'id':aid,'title':title,'summary':title,'file':'base/'+aid+'.md','stage':'基膜','tags':[],'aliases':[]})
        (directory/'index.json').write_text(json.dumps({'articles':articles}),encoding='utf-8')
        nodes=[{'id':aid,'label':label,'stage':'基膜','summary':label,'type':'机理','article_ids':[aid]}
               for aid,label in [('a','alpha'),('b','neutral'),('c','omega')]]
        edges=[{'id':'e1','source':'a','target':'b','mechanism':'alpha can transfer under stated condition','conditions':['Only while wet'],
                'checks':['Compare positions'],'article_ids':['b']},
               {'id':'e2','source':'b','target':'c','mechanism':'omega verification of alpha transfer','conditions':['Same specimen'],
                'checks':['Compare baseline'],'article_ids':['c']}]
        (root/'graph').mkdir();(root/'graph'/'toy.json').write_text(json.dumps({'nodes':nodes,'edges':edges}),encoding='utf-8')
        return KnowledgeStore(root)

    def test_linked_document_read_even_without_keyword_match_and_paths_are_bounded(self):
        with tempfile.TemporaryDirectory() as temp:
            s=self.make_store(Path(temp))
            self.assertNotIn('b',[r['article_id'] for r in s.search('alpha')])
            ctx=s.context({'issue':'alpha','retrieval_focus':'alpha'})
            self.assertIn('b',ctx['activation']['article_ids'])
            self.assertIn('unrelated zzz material marker',ctx['messages'][1]['content'])
            self.assertIn('Only while wet',ctx['messages'][1]['content'])
            self.assertIn('Compare positions',ctx['messages'][1]['content'])
            self.assertTrue(any(t['hop']==2 for t in ctx['retrieval_trace']))
            self.assertTrue(all(t['hop']<=2 for t in ctx['retrieval_trace']))

    def test_custom_gate_applies_to_keyword_explicit_links_and_graph_backing_articles(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);s=self.make_store(root)
            inbox=root/'知识投递';inbox.mkdir()
            (inbox/'sample.md').write_text('---\ntitle: Private synthetic\nstage: 基膜\nlinks: b\n---\n# Private synthetic\n\nalpha private synthetic content sufficiently long',encoding='utf-8')
            s=KnowledgeStore(root);uid=next(a['id'] for a in s.articles if a.get('origin')=='user')
            s.edges[0]['article_ids'].append(uid)
            hidden=s.context({'issue':'alpha','retrieval_focus':'alpha'},for_model=True)
            self.assertNotIn(uid,hidden['activation']['article_ids'])
            self.assertNotIn('private synthetic content',hidden['messages'][1]['content'])
            visible=s.context({'issue':'alpha','retrieval_focus':'alpha','allow_custom':True},for_model=True)
            self.assertIn(uid,visible['activation']['article_ids'])
            self.assertTrue(any(e.get('kind')=='explicit' for e in visible['related_edges']))

    def test_context_highlights_only_supplied_material_and_respects_scope_budget(self):
        s=KnowledgeStore()
        for budget in (5000,16000):
            ctx=s.context({'issue':'涂覆透气增值','stage':'涂覆','retrieval_focus':'干燥迁移 涂覆透气增值','context_chars':budget})
            self.assertLessEqual(ctx['knowledge_chars'],budget)
            self.assertEqual(set(ctx['activation']['article_ids']),{c['article_id'] for c in ctx['retrieved']})
            self.assertEqual(set(ctx['activation']['edge_ids']),{e['id'] for e in ctx['related_edges']})
            for c in ctx['retrieved']:
                self.assertIn(c['stage'],('涂覆','方法'))
                self.assertIn(c['text'],ctx['messages'][1]['content'])
            for t in ctx['retrieval_trace']:
                self.assertTrue(set(t['article_ids'])<=set(ctx['activation']['article_ids']))
                self.assertTrue(set(t['edge_ids'])<=set(ctx['activation']['edge_ids']))


if __name__=='__main__':unittest.main()
