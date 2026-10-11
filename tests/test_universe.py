from pathlib import Path
import json
import tempfile
import unittest
import io
import zipfile
from app.core import KnowledgeStore
from app.custom_knowledge import load, signature, universe


class UniverseTests(unittest.TestCase):
    def fixture(self, root):
        notes=root/'知识投递'
        notes.mkdir()
        (notes/'_模板.md').write_text('# 不应加载\n这是说明模板，不应该成为检索正文。',encoding='utf-8')
        (notes/'first.md').write_text('---\ntitle: 合成主题甲\nstage: 涂覆\ntags: 独特合成关键词\n---\n# 合成主题甲\n\n独特合成关键词表示人工构造的验证主题，无真实生产数据。关联到 [[合成主题乙]]，仅用于软件测试。',encoding='utf-8')
        (notes/'second.txt').write_text('# 合成主题乙\n\n这个主题提供对比、测量与反证的通用检查思路。',encoding='utf-8')
        (root/'首批文件').mkdir()
        (root/'首批文件'/'never.md').write_text('# 禁止扫描的哨兵\nORIGINAL_PRIVATE_SENTINEL',encoding='utf-8')
        return notes

    def test_inbox_scope_and_wikilink_graph(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);self.fixture(root);store=KnowledgeStore(root)
            self.assertEqual(len(store.articles),2)
            self.assertEqual(store.custom_status['loaded'],2)
            graph=universe(store)
            self.assertEqual(len(graph['nodes']),2)
            self.assertEqual(len(graph['edges']),1)
            self.assertEqual(graph['edges'][0]['kind'],'explicit')
            self.assertNotIn('ORIGINAL_PRIVATE_SENTINEL',json.dumps(graph,ensure_ascii=False))
            self.assertTrue(store.search('独特合成关键词'))

    def test_custom_context_is_local_until_explicitly_allowed(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);self.fixture(root);store=KnowledgeStore(root)
            p={'issue':'独特合成关键词是什么？'}
            local=store.context(p)
            remote=store.context(p,for_model=True)
            allowed=store.context(dict(p,allow_custom=True),for_model=True)
            self.assertTrue(local['retrieved'])
            self.assertEqual(remote['retrieved'],[])
            self.assertTrue(allowed['retrieved'])
            self.assertIn('用户自建，未审核',allowed['messages'][1]['content'])

    def test_changes_and_deletion_update_signature(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);notes=self.fixture(root);before=signature(root)
            p=notes/'second.txt';p.write_text('# 修改主题乙\n\n修改后的合成内容，用于验证更新及删除。',encoding='utf-8')
            self.assertNotEqual(before,signature(root));current=signature(root)
            p.unlink()
            self.assertNotEqual(current,signature(root));self.assertEqual(len(load(root)[0]),1)

    def test_invalid_and_oversized_notes_do_not_break_other_notes(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);notes=self.fixture(root)
            (notes/'broken.md').write_bytes(b'\xff\xfeinvalid')
            (notes/'huge.md').write_bytes(b'x'*512001)
            (notes/'too-short.md').write_text('short')
            articles,status=load(root)
            self.assertEqual(len(articles),2)
            self.assertEqual(len(status['issues']),3)

    def test_activation_matches_material_actually_included(self):
        store=KnowledgeStore();ctx=store.context({'issue':'涂覆透气增值上升','context_chars':6000})
        self.assertEqual(set(ctx['activation']['article_ids']),{c['article_id'] for c in ctx['retrieved']})
        text=ctx['messages'][1]['content']
        for edge_id in ctx['activation']['edge_ids']:
            edge=next(e for e in store.edges if e['id']==edge_id)
            self.assertIn(edge['mechanism'],text)
        graph=universe(store);ids={n['id'] for n in graph['nodes']}
        self.assertTrue(all(e['source'] in ids and e['target'] in ids for e in graph['edges']))

    def test_new_notes_never_enter_default_export(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);self.fixture(root)
            (root/'README.md').write_text('public')
            (root/'bundle_manifest.json').write_text(json.dumps({'knowledge_files':['README.md']}))
            store=KnowledgeStore(root)
            with zipfile.ZipFile(io.BytesIO(store.portable_bundle())) as z:
                self.assertEqual(z.namelist(),['README.md'])


if __name__=='__main__':
    unittest.main()
