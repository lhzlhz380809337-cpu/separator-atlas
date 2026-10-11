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


if __name__=='__main__':unittest.main()
