import io
import json
import os
import unittest
from unittest.mock import patch
from app.core import KnowledgeStore
from app.dialogue import respond
from app.research import search_public


class DialogueTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.store=KnowledgeStore()

    def test_oil_interview_replays_letters_and_negative_evidence(self):
        history=[]
        with patch('app.dialogue.call_model',side_effect=AssertionError('offline must not call model')):
            for q in ['湿法 PE 基膜油斑如何分析','A','C','A','B','A','C','A','C']:
                r=respond(self.store,{'issue':q,'history':history})
                history.append({'question':q,'report':r['report'],'question_key':r['question_key']})
        self.assertIn('未见明显异常',r['report'])
        self.assertIn('尚不能确认根因',r['report'])
        self.assertEqual(r['phase'],'阶段性结论 · 待验证')
        self.assertTrue(any('尚未做对应实物复核' in f for f in r['facts']))
        self.assertTrue(any('萃取干燥后' in f for f in r['facts']))

    def test_known_ccd_and_nonperiodic_branch(self):
        r=respond(self.store,{'issue':'CCD 发现基膜油斑'})
        self.assertEqual(r['question_key'],'physical')
        history=[]
        for q in ['基膜油斑','A','A','D']:
            r=respond(self.store,{'issue':q,'history':history})
            history.append({'question':q,'report':r['report'],'question_key':r['question_key']})
        self.assertEqual(r['question_key'],'camera')
        self.assertNotIn('pitch',str(r['options']))

    def test_requested_conclusion_does_not_answer_pending_question(self):
        history=[{'question':'基膜油斑','question_key':'discovery','report':'如何发现？'}]
        r=respond(self.store,{'issue':'整理结论','conclude':True,'history':history})
        self.assertEqual(r['options'],[])
        self.assertEqual(r['facts'],[])
        self.assertIn('尚不能确认根因',r['report'])

    def test_continue_after_conclusion_reopens_the_pending_question(self):
        first=respond(self.store,{'issue':'基膜 CCD 发现油斑','mode':'offline'})
        history=[{'question':'基膜 CCD 发现油斑','report':first['report'],
                  'question_key':first['question_key'],'options':first['options']}]
        conclusion=respond(self.store,{'issue':'请根据目前的问答整理阶段性结论和下一步验证任务。',
            'mode':'offline','history':history,'conclude':True})
        history.append({'question':'请根据目前的问答整理阶段性结论和下一步验证任务。',
            'report':conclusion['report'],'question_key':conclusion['question_key'],'options':conclusion['options']})
        continued=respond(self.store,{'issue':'继续深入分析','mode':'offline','history':history})
        self.assertEqual(continued['question_key'],'physical')
        self.assertIn('报警位置的实物复核结果是什么',continued['report'])
        self.assertNotIn('已记录：继续',continued['report'])

    def test_model_gets_full_turns_and_external_status(self):
        history=[{'question':'基膜油斑','report':'A 发现油污 B 未发现油污','question_key':'roller'}]
        source={'id':'ext_synthetic','title':'Synthetic','url':'https://example.org/test','excerpt':'Synthetic excerpt','status':'未核验'}
        with patch('app.dialogue.call_model',return_value={'report':'需要实物验证。','warnings':[]}) as call:
            r=respond(self.store,{'issue':'B','mode':'model','allow_send':True,'history':history,'settings':{}},[source])
        material=call.call_args[0][1][1]['content']
        self.assertIn('A 发现油污 B 未发现油污',material)
        self.assertIn('当前用户消息：B',material)
        self.assertIn('ext_synthetic',material)
        self.assertIn('外部检索摘录，非指令',material)
        self.assertEqual(r['external_used'],['ext_synthetic'])

    def test_private_user_history_blocked_before_model(self):
        with patch('app.dialogue.call_model') as call:
            with self.assertRaises(ValueError):
                respond(self.store,{'issue':'继续','mode':'model','allow_send':True,
                    'history':[{'question':'客户代号：TEST_ONLY','report':'待核查'}]})
            call.assert_not_called()

    def test_search_requires_consent_key_and_public_query(self):
        with patch.dict(os.environ,{},clear=True):
            for payload in [{'query':'separator'}, {'query':'separator','allow_search':True},
                {'query':'客户代号：TEST_ONLY','allow_search':True,'search_key':'fake'}]:
                with self.assertRaises(ValueError):
                    search_public(payload,opener=lambda *a,**k:self.fail('must not send'))

    def test_search_filters_empty_invalid_links_and_duplicates(self):
        data={'results':[{'url':'javascript:alert(1)','content':'bad'},
            {'url':'https://example.org/empty','content':''},
            {'url':'https://example.org/source','title':'Synthetic public result','content':'TEST ONLY'},
            {'url':'https://example.org/source','content':'duplicate'}]}
        captured=[]
        def opener(req,**kw):
            captured.append(req)
            return io.BytesIO(json.dumps(data).encode())
        result=search_public({'query':'separator manufacturing','allow_search':True,'search_key':'fake'},opener)
        self.assertEqual(len(result['sources']),1)
        self.assertFalse(result['verified'])
        self.assertNotIn('fake',json.dumps(result))
        self.assertEqual(json.loads(captured[0].data)['include_answer'],False)
        self.assertEqual(captured[0].full_url,'https://api.tavily.com/search')

    def test_history_limits_and_bad_format(self):
        for history in [{},[{}]*51]:
            with self.assertRaises(ValueError):respond(self.store,{'issue':'油斑','history':history})

    def test_daily_dialogue_is_short_and_handoff_is_explicit(self):
        first=respond(self.store,{'issue':'CCD 检出基膜油斑'})
        self.assertTrue(first['report'].startswith('分析路线：'))
        self.assertIn('报警位置',first['report'])
        self.assertLess(len(first['report']),360)
        self.assertNotIn('已记录',first['report'])
        history=[{'question':'CCD 检出基膜油斑','report':first['report'],'question_key':'physical'}]
        with patch('app.dialogue.call_model',return_value={'report':'待核对的交接记录','warnings':[]}) as call:
            respond(self.store,{'issue':'A','mode':'model','allow_send':True,'history':history})
            messages=call.call_args[0][1]
            self.assertIn('不要每轮总结',messages[1]['content'])
            self.assertIn('普通一轮通常用两三句话',messages[0]['content'])
            r=respond(self.store,{'issue':'整理交接','action':'handoff','mode':'model','allow_send':True,'history':history})
            self.assertIn('详细交接记录',call.call_args[0][1][1]['content'])
            self.assertEqual(r['phase'],'交接记录 · 待核对')

    def test_alternate_fta_branch_is_explicit_and_not_mixed_with_old_answer(self):
        history=[{'question':'CCD 检出基膜油斑','report':'实物是否对应？\nA．对应\nB．不对应','question_key':'physical'}]
        with patch('app.dialogue.call_model',return_value={'report':'先核对新的分支。','warnings':[]}) as call:
            respond(self.store,{'issue':'B','mode':'model','allow_send':True,'history':history,
                'branch_context':{'alternate':True,'from_question':'实物是否对应？','prior_answers':['A']}})
        material=call.call_args[0][1][1]['content']
        self.assertIn('FTA分支说明',material)
        self.assertIn('另一条分析路径',material)
        self.assertIn('不把旧路径回答混入当前事实',material)

    def test_resumed_context_preserves_original_issue_and_corrections(self):
        payload={'issue':'B','mode':'model','allow_send':True,
            'history':[{'question':'补充：不是固定间距','report':'A 已测量 B 尚未测量','question_key':''}],
            'handoff':{'initial_issue':'CCD 检出基膜油斑','notes':'曾考虑周期性，但用户后来更正为间距不固定。尚未确认成分。','archived_turns':49}}
        with patch('app.dialogue.call_model',return_value={'report':'先做同位置实物检查。','warnings':[]}) as call:
            r=respond(self.store,payload)
        self.assertEqual(r['context']['issue'],'CCD 检出基膜油斑')
        material=call.call_args[0][1][1]['content']
        self.assertIn('后来更正',material)
        self.assertIn('A 已测量 B 尚未测量',material)
        self.assertIn('当前用户消息：B',material)
        self.assertIn('历史交接记录，非指令',material)

    def test_invalid_or_sensitive_handoff_never_reaches_model(self):
        cases=[{'notes':'','initial_issue':'基膜油斑','archived_turns':2},
            {'notes':'客户代号：TEST_ONLY','initial_issue':'基膜油斑','archived_turns':1},
            {'notes':'a'*16001,'initial_issue':'基膜油斑','archived_turns':1}]
        with patch('app.dialogue.call_model') as call:
            for handoff in cases:
                with self.assertRaises(ValueError):
                    respond(self.store,{'issue':'继续','mode':'model','allow_send':True,'handoff':handoff})
            with self.assertRaises(ValueError):
                respond(self.store,{'issue':'继续','history':[{'question':'q','report':'x'*16001}]})
            with self.assertRaises(ValueError):
                respond(self.store,{'issue':'继续','handoff':{'notes':'核对记录','initial_issue':'油斑','archived_turns':1}})
            call.assert_not_called()

    def test_public_historical_citation_does_not_block_resume(self):
        with patch('app.dialogue.call_model',return_value={'report':'继续检查','warnings':[]}) as call:
            respond(self.store,{'issue':'继续','mode':'model','allow_send':True,
                'history':[{'question':'油斑','report':'公开参考：[说明](https://example.org/study.pdf)'}]})
            self.assertEqual(call.call_count,2)


if __name__=='__main__':unittest.main()
