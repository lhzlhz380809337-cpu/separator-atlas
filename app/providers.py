"""Minimal model adapter. API keys come from request, protected local settings, or environment.

Credentials are resolved from the request, protected local settings, or environment by this module. No external call occurs in offline
analysis. Keep provider-specific behavior behind this small replaceable boundary.
"""
from __future__ import annotations
import json
import os
import socket
import ssl
from urllib import request, error
from urllib.parse import urlsplit, urlunsplit


class ProviderError(Exception):
    pass


def connection_error(exc):
    """Classify transport failures without exposing addresses, keys or raw errors."""
    reason = exc.reason if isinstance(exc, error.URLError) else exc
    code = getattr(reason, "winerror", None) or getattr(reason, "errno", None)
    if isinstance(reason, PermissionError) or code in (13, 10013):
        return ("程序的联网请求被运行环境或系统权限阻止。若使用的是预览服务，请关闭该服务，"
                "再双击文件夹中的“start-workbench.ps1”以普通本机方式启动；仍失败时检查防火墙对 Python 的访问规则。")
    if isinstance(reason, ssl.SSLCertVerificationError):
        return "模型服务的 HTTPS 证书校验失败。请检查系统时间、可信证书或网络代理配置，不要关闭证书校验。"
    if isinstance(reason, ssl.SSLError):
        return "与模型服务建立 HTTPS 加密连接失败。请检查网络代理及服务地址是否正确。"
    if isinstance(reason, socket.gaierror):
        return "无法解析模型接口域名。请检查接口地址拼写、DNS 和网络连接。"
    if isinstance(reason, (TimeoutError, socket.timeout)) or code in (10060, 110):
        return "等待模型服务响应超时（当前网络等待上限 90 秒）。请稍后重试，并检查网络代理及服务状态。"
    if isinstance(reason, ConnectionRefusedError) or code in (10061, 111):
        return "模型服务或网络代理拒绝连接。请检查接口端口、代理状态；本机模型需先启动服务。"
    if isinstance(reason, (ConnectionResetError, ConnectionAbortedError)) or code in (10053, 10054):
        return "与模型服务的连接被中断。请检查网络代理、防火墙及服务状态，再重试。"
    return "无法连接模型服务。请检查接口地址、系统代理及当前网络；这不等于密钥验证失败。"


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ProviderError("模型服务返回重定向；请填写最终接口地址，避免凭据被转发。")


def endpoint(base_url: str, protocol="chat_completions") -> str:
    raw = str(base_url).strip().rstrip("/")
    parts = urlsplit(raw)
    if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password or parts.query or parts.fragment:
        raise ProviderError("接口地址需为不含账号、查询参数或片段的 HTTP(S) 地址。")
    if parts.scheme == "http" and parts.hostname not in ("localhost", "127.0.0.1", "::1"):
        raise ProviderError("远程模型接口请使用 HTTPS；本机模型可以使用 HTTP。")
    suffix = "/responses" if protocol == "responses" else "/chat/completions"
    if not parts.path:
        raw += "/v1"
    if raw.endswith(suffix):
        return raw
    if raw.endswith("/chat/completions") or raw.endswith("/responses"):
        raise ProviderError("接口路径与所选协议不一致。")
    return raw + suffix


def settings_from(payload):
    protocol = payload.get("protocol", "chat_completions")
    if protocol not in ("chat_completions", "responses"):
        raise ProviderError("不支持的协议")
    base_url = payload.get("base_url") or os.environ.get("SEPARATOR_BASE_URL", "")
    env_base = os.environ.get("SEPARATOR_BASE_URL", "")
    # A saved destination must never silently receive another service's key.
    api_key = str(payload.get("api_key") or "").strip()
    if not api_key and payload.get('use_saved_key') is True:
        from app.local_config import saved_key
        api_key = saved_key(base_url, protocol)
    if not api_key and payload.get("use_env_key", True) and env_base:
        try:
            if endpoint(base_url, protocol) == endpoint(env_base, protocol):
                api_key = os.environ.get("SEPARATOR_API_KEY", "")
        except ProviderError:
            pass
    return {"base_url": base_url,
        "model": payload.get("model") or os.environ.get("SEPARATOR_MODEL", ""),
        "api_key": api_key,
        "protocol": protocol}


def call_model(settings, messages, opener=None):
    model = str(settings.get("model", "")).strip()
    if not model or len(model) > 200:
        raise ProviderError("请填写模型名称。")
    protocol = settings.get("protocol", "chat_completions")
    url = endpoint(settings.get("base_url", ""), protocol)
    if protocol == "responses":
        body = {"model": model, "instructions": messages[0]["content"],
            "input": [{"role": "user", "content": messages[-1]["content"]}], "store": False}
    else:
        # Deliberately omit temperature/max_tokens/response_format for compatibility.
        body = {"model": model, "messages": messages, "stream": False}
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    api_key = str(settings.get("api_key", "")).strip()
    if api_key:
        headers["Authorization"] = "Bearer " + api_key
    req = request.Request(url, data=json.dumps(body, ensure_ascii=False).encode("utf-8"), headers=headers, method="POST")
    open_request = opener or request.build_opener(NoRedirect()).open
    try:
        with open_request(req, timeout=90) as response:
            raw = response.read(3_000_001)
            if len(raw) > 3_000_000:
                raise ProviderError("模型返回内容过大。")
            data = json.loads(raw.decode("utf-8"))
    except error.HTTPError as exc:
        # Do not echo provider response bodies; they can include input or credentials.
        explanations = {400:"请求格式或模型参数不兼容，请检查协议与模型名称。",401:"认证失败，请检查密钥。",402:"模型服务账户余额不足，请到服务商平台检查余额。",403:"服务拒绝访问，请检查模型权限。",404:"接口或模型不存在，请检查地址、协议和模型名。",422:"模型服务不接受当前参数，请检查协议与模型名称。",429:"调用速率或并发受限，请稍后重试。",500:"模型服务内部错误，请稍后重试。",503:"模型服务繁忙，请稍后重试。"}
        raise ProviderError(explanations.get(exc.code, f"模型接口返回 HTTP {exc.code}，请检查服务状态及接口兼容性。")) from None
    except (error.URLError, TimeoutError, OSError) as exc:
        raise ProviderError(connection_error(exc)) from None
    except (ValueError, UnicodeError):
        raise ProviderError("模型接口未返回有效 JSON，请检查协议。") from None
    if not isinstance(data, dict):
        raise ProviderError("模型接口返回了不兼容的 JSON 结构。")
    if protocol == "responses":
        if not isinstance(data.get("output", []), list):
            raise ProviderError("模型接口返回了不兼容的输出结构。")
        content = "\n".join(str(part.get("text", "")) for item in data.get("output", [])
                            if isinstance(item, dict) and isinstance(item.get("content", []), list)
                            for part in item.get("content", []) if isinstance(part, dict) and part.get("type") == "output_text")
    else:
        try:
            content = data["choices"][0]["message"]["content"]
            if isinstance(content, list):
                content = "\n".join(p.get("text", "") for p in content if isinstance(p, dict))
        except (KeyError, IndexError, TypeError):
            content = ""
    if not isinstance(content, str) or not content.strip():
        raise ProviderError("模型返回了空答案或不兼容的结构。知识材料仍可离线使用。")
    warnings = []
    if protocol == "responses" and data.get("status") == "incomplete":
        warnings.append("模型返回状态为未完成；当前答案可能被截断，请调整材料预算或服务输出限制后重试。")
    if protocol == "chat_completions" and data.get("choices", [{}])[0].get("finish_reason") in ("length", "content_filter"):
        warnings.append("模型输出提前结束；当前答案可能不完整，请检查服务输出限制及响应状态。")
    return {"report": content, "model": model, "usage": data.get("usage", {}), "warnings":warnings}
