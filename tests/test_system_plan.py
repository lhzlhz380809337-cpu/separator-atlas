import json
import unittest
from unittest.mock import patch
from app.core import KnowledgeStore
from app.dialogue import respond
from app import analysis_state


class SystemPlanTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.store = KnowledgeStore()

    def run_model(self, payload, answer='请补充现场观察。', plan=None):
        with patch('app.dialogue.call_model', side_effect=[{'report':json.dumps(plan or {},ensure_ascii=False)}, {'report':answer}]) as call:
            result = respond(self.store, dict(mode='model', allow_send=True, **payload))
            self.assertEqual(call.call_count, 2)
            return result, call.call_args[0][1]

    def history(self):
        return [{'question':'涂覆膜在导辊后出现掉粉', 'report':'对照样也掉粉吗？\nA．也掉粉\nB．没有\nC．尚未核查',
                 'options':[{'value':'A','label':'也掉粉'},{'value':'B','label':'没有'},{'value':'C','label':'尚未核查'}]}]

    def test_plan_is_not_evidence_and_pending_survives_letters_and_replay(self):
        history = self.history()
        result, messages = self.run_model({'issue':'请给系统方案','history':history}, '先观察再做对照。\nA．这个编号不是下一问')
        self.assertEqual(result['turn_kind'],'system_plan')
        self.assertEqual(result['options'],[])
        self.assertEqual(len(result['analysis_state']['facts']),1)
        self.assertEqual(result['resume_pending']['question'],'对照样也掉粉吗？')
        self.assertIn('不需要先排除到唯一根因',messages[1]['content'])
        history.append(dict(question='请给系统方案', **{k:result[k] for k in ('report','options','turn_kind')}))
        for state in (result['analysis_state'], None):
            next_result, _ = self.run_model({'issue':'B','history':history,'analysis_state':state})
            self.assertEqual(next_result['analysis_state']['facts'][-1]['answer'],'没有')
            self.assertEqual(next_result['analysis_state']['facts'][-1]['prompt'],'对照样也掉粉吗？')
            self.assertEqual(len(next_result['analysis_state']['facts']),2)

    def test_new_observation_with_request_is_retained_and_not_truncated(self):
        report='方案说明。'*100
        result, _ = self.run_model({'issue':'导辊后掉粉明显增加，请给系统性方案'},report)
        self.assertEqual(result['report'],report)
        self.assertEqual(result['analysis_state']['facts'][0]['answer'],'导辊后掉粉明显增加')

    def test_button_explicit_action_and_unknown_have_no_false_readiness(self):
        result, _ = self.run_model({'issue':'请生成系统方案','action':'system_plan','history':self.history()})
        self.assertFalse(result['plan_readiness']['ready'])
        self.assertEqual(len(result['analysis_state']['facts']),1)
        unknown, _ = self.run_model({'issue':'C','history':self.history()},plan={'plan_basis':{'scope':['f1'],'location':['f1'],'action':['f2']}})
        self.assertFalse(unknown['plan_readiness']['ready'])
        self.assertEqual(unknown['analysis_state']['plan_basis']['action'],[])

    def test_grounded_readiness_relations_and_multi_select(self):
        plan={'hypotheses':[{'id':'h1','text':'摩擦可能参与','status':'candidate','support':['f1'],'against':[]},
                            {'id':'h2','text':'涂层结合可能参与','status':'candidate','support':['f1'],'against':[]}],
              'factor_relations':[{'kind':'joint','members':['h1','h2'],'fact_ids':['f1'],'reason':'需要组合验证'}],
              'plan_basis':{'scope':['f1'],'location':['f1'],'action':['f1']}}
        result,_=self.run_model({'issue':'导辊前后已对照留样，辊后掉粉增加，可同步记录速度'},plan=plan)
        self.assertTrue(result['plan_readiness']['ready'])
        self.assertEqual(result['analysis_state']['factor_relations'][0]['status'],'unverified')
        multi,_=self.run_model({'issue':'A、B 补充有差异','history':self.history()})
        self.assertIn('也掉粉；没有；补充有差异',multi['analysis_state']['facts'][-1]['answer'])

    def test_corrections_clear_readiness_evidence(self):
        result,_=self.run_model({'issue':'辊后固定周期掉粉'},plan={'plan_basis':{'scope':['f1'],'location':['f1'],'action':['f1']}})
        history=[{'question':'辊后固定周期掉粉','report':result['report']}]
        corrected,_=self.run_model({'issue':'更正，不是辊后固定周期掉粉','history':history,'analysis_state':result['analysis_state']})
        self.assertFalse(corrected['plan_readiness']['ready'])

    def test_system_plan_requires_model_and_negative_request_stays_dialogue(self):
        with self.assertRaises(ValueError):respond(self.store,{'issue':'给系统方案'})
        result,_=self.run_model({'issue':'先不要系统方案，继续分析','history':self.history()})
        self.assertEqual(result['turn_kind'],'dialogue')

    def test_invalid_relation_reference_is_rejected(self):
        state=analysis_state.advance({},[], '掉粉','掉粉')
        with self.assertRaises(ValueError):
            analysis_state.apply_plan(state, {'factor_relations':[{'kind':'joint','members':['missing','also_missing']}]})


if __name__ == '__main__':unittest.main()
