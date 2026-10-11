import io
import socket
import ssl
import unittest
from urllib import error
from app.providers import ProviderError, call_model, endpoint


class ConnectionErrorTests(unittest.TestCase):
    def test_distinct_network_failures_do_not_expose_raw_details(self):
        cases=[(PermissionError(13,'synthetic-secret'),'运行环境'),
               (socket.gaierror(-2,'synthetic-secret'),'域名'),
               (TimeoutError('synthetic-secret'),'90 秒'),
               (ssl.SSLCertVerificationError(1,'synthetic-secret'),'证书校验'),
               (ConnectionRefusedError('synthetic-secret'),'拒绝连接'),
               (ConnectionResetError('synthetic-secret'),'连接被中断')]
        for exc,expected in cases:
            for failure in (exc,error.URLError(exc)):
                with self.subTest(kind=type(failure).__name__,expected=expected):
                    def fail(req,timeout):raise failure
                    with self.assertRaises(ProviderError) as caught:
                        call_model({'base_url':'https://api.deepseek.com','model':'synthetic'},[],fail)
                    self.assertIn(expected,str(caught.exception))
                    self.assertNotIn('synthetic-secret',str(caught.exception))

    def test_http_balance_and_busy_messages(self):
        for code,expected in ((402,'余额不足'),(503,'繁忙'),(401,'认证失败')):
            def fail(req,timeout):raise error.HTTPError(req.full_url,code,'synthetic-secret',{},io.BytesIO(b'synthetic-secret'))
            with self.assertRaises(ProviderError) as caught:
                call_model({'base_url':'https://api.deepseek.com','model':'synthetic'},[],fail)
            self.assertIn(expected,str(caught.exception))
            self.assertNotIn('synthetic-secret',str(caught.exception))

    def test_deepseek_full_path_and_keepalive_blanks(self):
        self.assertEqual(endpoint('https://api.deepseek.com/chat/completions'),'https://api.deepseek.com/chat/completions')
        def reply(req,timeout):return io.BytesIO(b'\n\n {"choices":[{"message":{"content":"ok"}}]}')
        result=call_model({'base_url':'https://api.deepseek.com/chat/completions','model':'synthetic'},[],reply)
        self.assertEqual(result['report'],'ok')


if __name__=='__main__':unittest.main()
