"""The subprocess boundary: controlled rg arguments and lossless event streams."""
from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess
import tempfile
from typing import Iterator


class RgError(Exception):
    def __init__(self, code: str, message: str, diagnostics: bytes = b''):
        super().__init__(message)
        self.code = code
        self.diagnostics = diagnostics


class RgBackend:
    def __init__(self, root: Path, globs: list[str]):
        if shutil.which('rg') is None:
            raise RgError('ripgrep_unavailable', 'Install ripgrep and ensure rg is on PATH.')
        self.root = root
        self.args = ['rg', '--no-config']
        for glob in globs:
            self.args += ['--glob', glob]

    def _stream(self, options: list[str], separator: bytes) -> Iterator[bytes]:
        # Spooling stderr avoids the pipe-fill deadlock while stdout is streamed.
        # Only a bounded diagnostic prefix is returned to the CLI on failure.
        with tempfile.TemporaryFile() as diagnostics:
            try:
                proc = subprocess.Popen(self.args + options + ['--', str(self.root)],
                                        stdout=subprocess.PIPE, stderr=diagnostics)
            except FileNotFoundError:
                raise RgError('ripgrep_unavailable', 'Install ripgrep and ensure rg is on PATH.') from None
            except OSError:
                raise RgError('ripgrep_failed', 'Could not start the search process.') from None
            try:
                assert proc.stdout is not None
                pending = bytearray()
                while chunk := proc.stdout.read1(65536):
                    start = 0
                    while (end := chunk.find(separator, start)) != -1:
                        pending.extend(chunk[start:end])
                        yield bytes(pending)
                        pending.clear()
                        start = end + len(separator)
                    pending.extend(chunk[start:])
                if pending:
                    raise RgError('ripgrep_failed', 'The search process returned an incomplete record.')
                code = proc.wait()
                diagnostics.seek(0)
                detail = diagnostics.read(65536)
                if code not in (0, 1):
                    invalid = any(marker in detail for marker in (
                        b'regex parse error',
                        b'error parsing regex',
                        b'the literal "\\n" is not allowed in a regex',
                        b'pattern contains "\\0" but it is impossible to match',
                        b'compiled regex exceeds size limit',
                    ))
                    raise RgError('invalid_pattern' if invalid else 'ripgrep_failed',
                                  'Check the search regular expression.' if invalid else
                                  'The search could not complete; check stderr diagnostics and retry.', detail)
            finally:
                # Closing a stream early, malformed output, and CLI interruption
                # all reap the child. Forced termination is never a successful scan.
                if proc.poll() is None:
                    proc.terminate()
                    try:
                        proc.wait(timeout=1)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.wait()
                if proc.stdout is not None:
                    proc.stdout.close()

    def files(self) -> Iterator[bytes]:
        yield from self._stream(['--files', '-0'], b'\0')

    def events(self, pattern: str, before: int = 0, after: int = 0) -> Iterator[dict]:
        args = ['--json', '--line-number', '--column', '-B', str(before), '-A', str(after), '-e', pattern]
        summary = False
        # Explicitly close the underlying stream if JSON parsing fails.
        stream = self._stream(args, b'\n')
        try:
            for raw in stream:
                try:
                    event = json.loads(raw)
                    if not isinstance(event, dict) or 'type' not in event:
                        raise ValueError('invalid event')
                except (ValueError, UnicodeDecodeError):
                    raise RgError('ripgrep_failed', 'The search process returned an invalid event.') from None
                summary = summary or event['type'] == 'summary'
                yield event
            if not summary:
                raise RgError('ripgrep_failed', 'The search process did not report scan completion.')
        finally:
            stream.close()
