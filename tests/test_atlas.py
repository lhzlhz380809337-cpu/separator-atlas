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


if __name__=='__main__':unittest.main()
