"""Verify graph knowledge is usable in reading, retrieval, activation and migration."""
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from app.core import KnowledgeStore
from app.custom_knowledge import universe
from app.server import public_article


class AtlasTests(unittest.TestCase):
    def test_formal_notes_reach_search_context_and_sphere(self):
        store=KnowledgeStore()
        results=store.search('一牵引 含油膜 辊速差 张力 纠偏')
        self.assertIn('atlas_traction',{x['article_id'] for x in results})
        ctx=store.context({'issue':'一牵引含油膜因辊速差产生变形，如何控制？','context_chars':16000},for_model=True)
        self.assertIn('atlas_traction',ctx['activation']['article_ids'])
        body=ctx['messages'][1]['content']
        self.assertIn('质量控制点',body)
        self.assertIn('失控问题',body)
        graph=universe(store)
        self.assertTrue(any(n['id']=='doc:atlas_traction' for n in graph['nodes']))
        self.assertTrue(any(e['source']=='doc:atlas_traction' and e['target']=='base_traction' for e in graph['edges']))
        for eid in ctx['activation']['edge_ids']:
            edge=next(e for e in store.edges if e['id']==eid)
            self.assertIn(edge['mechanism'],body)
            self.assertTrue(all(c in body for c in edge['control_points']))

    def test_curated_atlas_is_exported_but_paths_are_not_public(self):
        store=KnowledgeStore()
        article=store.by_article['atlas_traction']
        self.assertNotIn('workspace_file',public_article(article))
        with zipfile.ZipFile(io.BytesIO(store.portable_bundle())) as z:
            self.assertIn('知识图谱/index.json',z.namelist())
            self.assertIn(article['workspace_file'],z.namelist())
            self.assertIn('一牵引',z.read(article['workspace_file']).decode('utf-8'))
            self.assertFalse(any(n.startswith('首批文件/') for n in z.namelist()))

    def test_atlas_index_cannot_read_outside_its_folder(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'知识图谱').mkdir()
            (root/'secret.md').write_text('synthetic private sentinel',encoding='utf-8')
            (root/'知识图谱/index.json').write_text(json.dumps({'articles':[{'file':'../secret.md'}]}),encoding='utf-8')
            with self.assertRaises(ValueError):KnowledgeStore(root)

    def test_all_relations_teach_cause_control_and_failure(self):
        store=KnowledgeStore()
        for edge in store.edges:
            for key in ('mechanism','control_points','failure_modes','conditions'):
                self.assertTrue(edge.get(key),f'{edge["id"]} missing {key}')
            aid=edge['article_ids'][0]
            self.assertTrue(aid.startswith('atlas_'))
            note=store.by_article[aid]['content']
            self.assertIn(edge['mechanism'],note)
            self.assertTrue(all(p in note for p in edge['control_points']))

    def test_field_lessons_are_retrievable_as_general_mechanisms(self):
        store=KnowledgeStore()
        cases={
            '厚度 面密度 孔隙率 透气 热收缩 联合判读':'atlas_base_performance',
            'CCD 固定位置 等间距 辊径 首次出现':'atlas_base_fingerprint',
            '涂覆 料盒 泡沫 回流 过滤压差 停机沉降':'atlas_coat_supply',
            '吸附辊 包角 网套 张力 打皱 条状漏涂':'atlas_coat_web',
            '横纹 凹版辊 背辊 联轴器 刮刀 料盒':'atlas_coat_head',
            '膜面不干 膜温 风量 热皱 辊面积料':'atlas_coat_drydefect',
        }
        for query,expected in cases.items():
            with self.subTest(query=query):
                self.assertIn(expected,{item['article_id'] for item in store.search(query,limit=8)})

    def test_defect_coverage_has_working_entries_and_stage_specific_routes(self):
        store=KnowledgeStore()
        coverage=json.loads((store.root/'evals/defect_coverage.json').read_text(encoding='utf-8'))['entries']
        self.assertGreaterEqual(len(coverage),50)
        for row in coverage:
            with self.subTest(node=row['node_id']):
                node=store.by_node[row['node_id']]
                self.assertEqual(node['stage'],row['stage'])
                self.assertTrue(node.get('diagnosis',{}).get('first_checks'))
                self.assertTrue(node['diagnosis']['branches'])
                self.assertTrue(node['diagnosis']['verification'])
                for query in row['queries']:
                    found={r['article_id'] for r in store.search(query,row['stage'],8)}
                    self.assertIn(row['article_id'],found)
        expected={
            '涂覆 CCD 黑点':('pb_coat_black','coat_black'),
            '涂覆 CCD 亮点':('pb_coat_bright','coat_bright'),
            '涂覆 厚度不均':('pb_coat_thickness_variation','coat_thickness_variation'),
            '涂覆 油斑':('pb_coat_oilspot','coat_oilspot'),
            '基膜 亮点':('pb_base_bright','base_bright'),
        }
        for query,(playbook,node_id) in expected.items():
            stage='基膜' if query.startswith('基膜') else '涂覆'
            ctx=store.context({'issue':query,'stage':stage,'context_chars':16000},for_model=True)
            self.assertEqual(ctx['playbooks'][0]['id'],playbook)
            self.assertIn(node_id,ctx['activation']['node_ids'])

    def test_defect_inheritance_is_conditional_and_old_graph_is_preserved(self):
        store=KnowledgeStore()
        edge=next(e for e in store.edges if e['source']=='base_black' and e['target']=='coat_black')
        self.assertEqual(edge['relation'],'可能传递')
        self.assertIn('不自动消除',edge['mechanism'])
        self.assertTrue(edge['conditions'])
        self.assertTrue(any(e['source']=='coat_hole' and e['target']=='cell_local_weak' for e in store.edges))
        self.assertGreaterEqual(len(store.nodes),157)
        self.assertGreaterEqual(len(store.edges),294)
        for nid in ('base_pe','base_black','coat_feed','coat_stripe','cell_resistance'):
            self.assertIn(nid,store.by_node)
        current_edges={e['id'] for e in store.edges}
        for eid in ('base_edge_001','coat_edge_001','bridge_01','field_base_001','field_coat_001'):
            self.assertIn(eid,current_edges)


if __name__=='__main__':unittest.main()
