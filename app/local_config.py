"""Per-user settings. Credentials are DPAPI protected and never returned to clients."""
import base64
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import tempfile
import threading

LOCK = threading.RLock()


def path():
    directory = os.environ.get('SEPARATOR_CONFIG_DIR')
    return (Path(directory) if directory else Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'SeparatorAtlas') / 'settings.local.json'


def crypt(data, decrypt=False):
    if os.name != 'nt':
        raise ValueError('当前系统不支持 Windows 密钥保护，可使用启动环境提供密钥。')
    class Blob(ctypes.Structure):
        _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]
    buffer = ctypes.create_string_buffer(data)
    incoming = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    outgoing = Blob()
    library = ctypes.WinDLL('crypt32', use_last_error=True)
    method = library.CryptUnprotectData if decrypt else library.CryptProtectData
    method.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    method.restype = wintypes.BOOL
    # CRYPTPROTECT_UI_FORBIDDEN, current user (never LOCAL_MACHINE).
    if not method(ctypes.byref(incoming), None, None, None, None, 1, ctypes.byref(outgoing)):
        raise ValueError('本机密钥保护失败，请使用原 Windows 用户或重新保存连接。')
    try:
        return ctypes.string_at(outgoing.data, outgoing.size)
    finally:
        free = ctypes.WinDLL('kernel32').LocalFree
        free.argtypes = [ctypes.c_void_p]
        free.restype = ctypes.c_void_p
        free(outgoing.data)


def read():
    with LOCK:
        target = path()
        if not target.exists():
            return {'version': 1}
        try:
            if target.stat().st_size > 40000:
                raise ValueError()
            value = json.loads(target.read_text(encoding='utf-8'))
            if not isinstance(value, dict) or value.get('version') != 1:
                raise ValueError()
            return value
        except (ValueError, OSError):
            raise ValueError('本机配置无法读取，原文件未覆盖。请恢复配置备份。') from None


def public():
    data = read()
    return {'model': data.get('model', {}), 'has_saved_key': bool(data.get('secret')),
            'preferences': data.get('preferences', {})}


def update(payload):
    from app.providers import endpoint
    with LOCK:
        data = read()
        action = payload.get('action', 'save')
        if action == 'save':
            settings = payload.get('settings', {})
            if not isinstance(settings, dict):
                raise ValueError('连接设置格式不正确。')
            protocol = settings.get('protocol', 'chat_completions')
            if protocol not in ('chat_completions', 'responses'):
                raise ValueError('接口协议不支持。')
            url, model = settings.get('base_url', ''), settings.get('model', '')
            key = settings.get('api_key', '')
            if not all(isinstance(x, str) for x in (url, model, key)) or len(url)>2000 or not model.strip() or len(model)>200 or len(key)>8000:
                raise ValueError('请填写有效的接口地址、模型名称和密钥。')
            destination = endpoint(url, protocol)
            if destination != data.get('destination'):
                data.pop('secret', None)
            if key.strip():
                data['secret'] = base64.b64encode(crypt(key.strip().encode('utf-8'))).decode('ascii')
            data['destination'] = destination
            data['model'] = {'base_url':url.strip(), 'model':model.strip(), 'protocol':protocol,
                             'allow_send':payload.get('allow_send') is True,
                             'context_chars':max(5000, min(40000, int(settings.get('context_chars', 16000))))}
        elif action == 'delete_key':
            data.pop('secret', None)
        elif action != 'preferences':
            raise ValueError('未知设置操作。')
        if 'preferences' in payload:
            incoming = payload['preferences']
            if not isinstance(incoming, dict):
                raise ValueError('显示偏好格式不正确。')
            prefs = data.setdefault('preferences', {})
            for key, allowed in {'font_size':(16,18,20), 'depth':('field','deep')}.items():
                if key in incoming:
                    if incoming[key] not in allowed:
                        raise ValueError('显示偏好超出范围。')
                    prefs[key] = incoming[key]
        target = path()
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=target.parent, delete=False) as stream:
                temporary = Path(stream.name)
                json.dump(data, stream, ensure_ascii=False)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, target)
        finally:
            if temporary and temporary.exists():
                temporary.unlink()
        return public()


def saved_key(base_url, protocol):
    from app.providers import endpoint
    data = read()
    if not data.get('secret') or endpoint(base_url, protocol) != data.get('destination'):
        return ''
    try:
        return crypt(base64.b64decode(data['secret'], validate=True), decrypt=True).decode('utf-8')
    except (ValueError, UnicodeError):
        raise ValueError('已保存密钥无法解密，请在当前电脑重新保存连接。') from None
