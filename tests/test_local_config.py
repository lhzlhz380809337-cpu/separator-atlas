import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from app import local_config
from app.providers import settings_from, ProviderError


class LocalConfigTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.env=patch.dict(os.environ, {'SEPARATOR_CONFIG_DIR':self.temp.name})
        self.env.start()

    def tearDown(self):
        self.env.stop();self.temp.cleanup()

    def save(self,key='synthetic-test-key'):
        return local_config.update({'settings':{'base_url':'https://example.org/v1','model':'test-model','api_key':key},'allow_send':True})

    @unittest.skipUnless(os.name=='nt','Windows DPAPI')
    def test_encrypted_key_roundtrip_destination_binding_and_delete(self):
        result=self.save()
        self.assertTrue(result['has_saved_key'])
        self.assertNotIn('synthetic-test-key',json.dumps(result))
        self.assertNotIn('synthetic-test-key',local_config.path().read_text())
        self.assertEqual(local_config.saved_key('https://example.org/v1/','chat_completions'),'synthetic-test-key')
        self.assertEqual(local_config.saved_key('https://other.example.org/v1','chat_completions'),'')
        self.assertEqual(local_config.saved_key('https://example.org/v1','responses'),'')
        settings=settings_from({'base_url':'https://example.org/v1','model':'test','use_saved_key':True,'use_env_key':False})
        self.assertEqual(settings['api_key'],'synthetic-test-key')
        self.save('')
        self.assertEqual(local_config.saved_key('https://example.org/v1','chat_completions'),'synthetic-test-key')
        local_config.update({'action':'delete_key'})
        self.assertFalse(local_config.public()['has_saved_key'])

    @unittest.skipUnless(os.name=='nt','Windows DPAPI')
    def test_changed_destination_drops_saved_key_and_plaintext_never_returned(self):
        self.save()
        changed=local_config.update({'settings':{'base_url':'https://other.example.org','model':'other'}})
        self.assertFalse(changed['has_saved_key'])
        self.assertNotIn('secret',changed)

    def test_preferences_merge_without_touching_model(self):
        self.save('')
        local_config.update({'action':'preferences','preferences':{'font_size':20,'depth':'deep'}})
        local_config.update({'action':'preferences','preferences':{'font_size':18}})
        value=local_config.public()
        self.assertEqual(value['model']['model'],'test-model')
        self.assertTrue(value['model']['allow_send'])
        self.assertEqual(value['preferences'],{'font_size':18,'depth':'deep'})

    def test_failed_write_preserves_existing_config(self):
        self.save('');before=local_config.path().read_bytes()
        with patch('app.local_config.os.replace',side_effect=OSError('synthetic failure')):
            with self.assertRaises(OSError):local_config.update({'action':'preferences','preferences':{'font_size':20}})
        self.assertEqual(local_config.path().read_bytes(),before)
        self.assertEqual(len(list(Path(self.temp.name).iterdir())),1)

    def test_corrupt_settings_not_overwritten_or_plaintext_fallback(self):
        local_config.path().write_text('{broken',encoding='utf-8')
        with self.assertRaises(ValueError):self.save('')
        self.assertEqual(local_config.path().read_text(),'{broken')

    def test_invalid_preferences_and_non_https_service(self):
        with self.assertRaises(ValueError):local_config.update({'action':'preferences','preferences':{'font_size':99}})
        with self.assertRaises(ProviderError):local_config.update({'settings':{'base_url':'http://example.org','model':'m'}})
        self.assertFalse(local_config.path().exists())


if __name__=='__main__':unittest.main()
