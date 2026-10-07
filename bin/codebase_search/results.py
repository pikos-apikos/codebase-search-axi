"""Normalize rg results, preserve bytes, and bound retained display records."""
from __future__ import annotations

import base64
import os
from collections import deque
from contextlib import closing
from pathlib import Path
from typing import Any

from .backend import RgBackend, RgError

Value = str | dict[str, str]


def encoded(raw: bytes) -> Value:
    try:
        return raw.decode('utf-8')
    except UnicodeDecodeError:
        return {'bytes': base64.b64encode(raw).decode('ascii')}


def rg_bytes(value: dict[str, str]) -> bytes:
    if 'text' in value:
        return value['text'].encode('utf-8')
    return base64.b64decode(value['bytes'], validate=True)


def relative_path(root: Path, raw: bytes) -> Value:
    # fsdecode/fsencode are internal filesystem transport only; surrogate
    # escapes are never exposed as JSON strings.
    path = Path(os.fsdecode(raw)).relative_to(root).as_posix()
    return encoded(os.fsencode(path))


def filesystem_path(root: Path, value: Value) -> Path:
    raw = value.encode('utf-8') if isinstance(value, str) else base64.b64decode(value['bytes'])
    return root / os.fsdecode(raw)


def envelope(command: str, key: str, values: list, total: int, limit: int | None) -> dict:
    display = len(values) == total
    record = {'status': 'ok', 'command': command, key: values, 'count': len(values),
              'returned': len(values), 'total': total, 'bounded': limit is not None,
              'complete': {'scan': True, 'display': display}}
    if not display:
        record['help'] = 'Use --all to return all results within the existing exclusions.'
    return record


def files(backend: RgBackend, limit: int | None) -> dict:
    values = []
    total = 0
    with closing(backend.files()) as stream:
        for raw in stream:
            total += 1
            if limit is None or len(values) < limit:
                values.append(relative_path(backend.root, raw))
    return envelope('files', 'files', values, total, limit)


def matches(backend: RgBackend, command: str, pattern: str, limit: int | None,
            before: int = 0, after: int = 0) -> dict:
    values: list[dict[str, Any]] = []
    total = 0
    previous: deque = deque(maxlen=before)
    following: list[dict[str, Any]] = []
    with closing(backend.events(pattern, before, after)) as stream:
        try:
            for event in stream:
                kind = event['type']
                if kind in ('begin', 'end'):
                    previous.clear()
                    following.clear()
                if kind not in ('match', 'context'):
                    continue
                data = event['data']
                line = data['line_number']
                text = encoded(rg_bytes(data['lines']))
                following = [item for item in following if line <= item['line'] + after]
                for item in following:
                    item['after'].append(text)
                if kind == 'match':
                    total += 1
                    if limit is None or len(values) < limit:
                        submatches = [{**match, 'match': encoded(rg_bytes(match['match']))}
                                      for match in data['submatches']]
                        item = {'path': relative_path(backend.root, rg_bytes(data['path'])),
                                'line': line, 'column': submatches[0]['start'] + 1,
                                'text': text, 'submatches': submatches}
                        if command == 'context':
                            item['before'] = [text for number, text in previous if number >= line - before]
                            item['after'] = []
                            if after:
                                following.append(item)
                        values.append(item)
                previous.append((line, text))
        except (KeyError, ValueError, TypeError, IndexError):
            raise RgError('ripgrep_failed', 'The search process returned an invalid result.') from None
    return envelope(command, 'matches', values, total, limit)


def metrics(backend: RgBackend, limit: int | None) -> dict:
    file_count = byte_count = line_count = 0
    with closing(backend.files()) as stream:
        for raw in stream:
            if limit is not None and file_count >= limit:
                break
            content = filesystem_path(backend.root, relative_path(backend.root, raw)).read_bytes()
            file_count += 1
            byte_count += len(content)
            line_count += content.count(b'\n') + int(bool(content) and not content.endswith(b'\n'))
    if limit is not None:
        return {'status': 'ok', 'command': 'metrics', 'files_seen': file_count,
                'bytes_seen': byte_count, 'lines_seen': line_count, 'bounded': True,
                'complete': {'scan': False, 'display': True},
                'help': 'Use --all to scan all files within the existing exclusions.'}
    return {'status': 'ok', 'command': 'metrics', 'files': file_count,
            'bytes': byte_count, 'lines': line_count, 'bounded': False,
            'complete': {'scan': True, 'display': True}}
