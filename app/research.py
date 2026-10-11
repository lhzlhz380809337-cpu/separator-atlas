"""Explicit public-query search; credentials and results never enter public bundles."""
import hashlib
import json
import os
from datetime import datetime, timezone
from urllib import request, error
from urllib.parse import urlsplit
from app.providers import ProviderError, NoRedirect
from app.privacy import check_outbound


def search_public(payload, opener=None):
    if payload.get('allow_search') is not True:
        raise ValueError('请开启联网补充后再检索。')
    query = str(payload.get('query', '')).strip()
    if not 3 <= len(query) <= 300:
        raise ValueError('请填写 3 至 300 字符的公开检索词。')
    check_outbound({'issue': query})
    key = str(payload.get('search_key') or os.environ.get('TAVILY_API_KEY', '')).strip()
    if not key:
        raise ValueError('尚未配置联网检索。请在模型设置中填写 Tavily 搜索密钥；本地对话仍可使用。')
    body = {'query': query, 'search_depth': 'basic', 'max_results': 5,
            'include_answer': False, 'include_raw_content': False}
    req = request.Request('https://api.tavily.com/search', data=json.dumps(body).encode(),
        headers={'Authorization': 'Bearer '+key, 'Content-Type': 'application/json'}, method='POST')
    try:
        with (opener or request.build_opener(NoRedirect()).open)(req, timeout=30) as response:
            raw = response.read(1_000_001)
            if len(raw) > 1_000_000:
                raise ProviderError('检索响应过大，请缩小检索范围。')
            data = json.loads(raw)
    except error.HTTPError as exc:
        raise ProviderError(f'联网检索返回 HTTP {exc.code}，请检查搜索密钥与额度。') from None
    except (error.URLError, OSError, ValueError):
        raise ProviderError('联网检索连接失败或返回格式异常。本地知识仍可使用。') from None
    if not isinstance(data, dict) or not isinstance(data.get('results'), list):
        raise ProviderError('搜索服务未返回兼容的结果列表。')
    sources, seen = [], set()
    for item in data['results'][:5]:
        if not isinstance(item, dict):
            continue
        url = str(item.get('url', ''))
        try:
            parsed = urlsplit(url)
        except ValueError:
            continue
        if parsed.scheme not in ('https', 'http') or not parsed.hostname or parsed.username or parsed.password or url in seen:
            continue
        text = str(item.get('content') or '').strip()
        if not text:
            continue
        seen.add(url)
        sources.append({'id': 'ext_'+hashlib.sha256(url.encode()).hexdigest()[:16],
            'title': str(item.get('title') or parsed.hostname)[:180], 'url': url,
            'excerpt': text[:1500], 'status': '外部检索摘录，未核验全文及适用性',
            'retrieved_at': datetime.now(timezone.utc).isoformat()})
    return {'query': query, 'sources': sources, 'provider': 'Tavily', 'verified': False}
