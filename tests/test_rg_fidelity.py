"""Public CLI regressions for the rg adapter; no private imports."""
import base64
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest


CLI = Path(__file__).resolve().parents[1] / 'bin' / 'codebase-search'


def value(raw):
    try:
        return raw.decode('utf-8')
    except UnicodeDecodeError:
        return {'bytes': base64.b64encode(raw).decode('ascii')}


class RgFidelity(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.tools = self.root / 'tools'

    def cli(self, command='search', pattern='needle', *flags, env=None):
        args = [sys.executable, str(CLI), command, '--root', str(self.root), *flags]
        if command in ('search', 'context'):
            args += ['--', pattern]
        proc = subprocess.run(args, capture_output=True, env=env, timeout=8)
        self.assertNotIn(b'Traceback', proc.stderr)
        return proc, json.loads(proc.stdout)

    def fake_rg(self, body):
        self.tools.mkdir()
        script = self.tools / 'rg'
        script.write_text('#!' + sys.executable + '\n' + body)
        script.chmod(0o755)
        return dict(os.environ, PATH=str(self.tools))

    def test_dash_pattern_is_a_value(self):
        (self.root / 'allowed.txt').write_text('-needle\nneedle\n')
        proc, data = self.cli('search', '-needle', '--all')
        self.assertEqual(proc.returncode, 0)
        self.assertEqual([m['line'] for m in data['matches']], [1])
        self.assertEqual(data['matches'][0]['text'], '-needle\n')

    def test_explicit_unbounded_search_and_context_return_76(self):
        (self.root / 'allowed.txt').write_text('needle\n' * 76)
        for command in ('search', 'context'):
            with self.subTest(command=command):
                proc, data = self.cli(command, 'needle', '--all')
                self.assertEqual(proc.returncode, 0)
                self.assertEqual(data['count'], 76)
                self.assertEqual(data['complete'], {'scan': True, 'display': True})
                self.assertEqual(data['total'], 76)
                self.assertEqual([m['line'] for m in data['matches']], list(range(1, 77)))

    def test_display_limit_keeps_scanning_and_counts_total(self):
        (self.root / 'allowed.txt').write_text('needle\n' * 76)
        proc, data = self.cli('search', 'needle', '--max-results', '3')
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(data['count'], 3)
        self.assertEqual(data['total'], 76)
        self.assertEqual(data['complete'], {'scan': True, 'display': False})
        self.assertIn('--all', data['help'])

    def test_non_utf8_paths_content_context_and_byte_offsets(self):
        name = b'bad-\xff.txt'
        contents = b'before \xfe\n\xc3\xa9 \xff needle needle\r\nafter \xfd\n'
        with open(os.fsencode(self.root) + b'/' + name, 'wb') as stream:
            stream.write(contents)
        proc, data = self.cli('context', 'needle', '--all', '--before', '1', '--after', '1')
        self.assertEqual(proc.returncode, 0)
        item = data['matches'][0]
        self.assertEqual(item['path'], value(name))
        self.assertEqual(item['text'], value(contents.splitlines(keepends=True)[1]))
        self.assertEqual(item['column'], 6)
        self.assertEqual([(m['start'], m['end']) for m in item['submatches']], [(5, 11), (12, 18)])
        self.assertEqual(item['before'], [value(b'before \xfe\n')])
        self.assertEqual(item['after'], [value(b'after \xfd\n')])
        proc, listing = self.cli('files', 'unused', '--all')
        self.assertEqual(proc.returncode, 0)
        self.assertIn(value(name), listing['files'])
        proc, metrics = self.cli('metrics', 'unused', '--all')
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(metrics['bytes'], len(contents))

    def test_non_utf8_submatch_bytes_are_lossless(self):
        (self.root / 'allowed.txt').write_bytes(b'prefix \xff\n')
        proc, data = self.cli('search', r'(?-u:\xFF)', '--all')
        self.assertEqual(proc.returncode, 0)
        item = data['matches'][0]
        self.assertEqual(item['text'], value(b'prefix \xff\n'))
        self.assertEqual(item['column'], 8)
        self.assertEqual(item['submatches'], [{'match': value(b'\xff'), 'start': 7, 'end': 8}])

    def test_non_utf8_root_does_not_corrupt_relative_paths(self):
        self.root = self.root / os.fsdecode(b'root-\xff')
        self.root.mkdir()
        (self.root / 'allowed.txt').write_text('needle\n')
        proc, data = self.cli('search', 'needle', '--all')
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(data['matches'][0]['path'], 'allowed.txt')

    def test_context_uses_rg_encoding_conversion(self):
        (self.root / 'allowed.txt').write_bytes('before\nneedle\nafter\n'.encode('utf-16'))
        proc, data = self.cli('context', 'needle', '--all', '--before', '1', '--after', '1')
        self.assertEqual(proc.returncode, 0)
        item = data['matches'][0]
        self.assertEqual((item['line'], item['column'], item['text']), (2, 1, 'needle\n'))
        self.assertEqual(item['before'], ['before\n'])
        self.assertEqual(item['after'], ['after\n'])

    def test_unavailable_rg(self):
        (self.root / 'allowed.txt').write_text('needle\n')
        self.tools.mkdir()
        proc, data = self.cli(env=dict(os.environ, PATH=str(self.tools)))
        self.assertEqual((proc.returncode, data['error']), (1, 'ripgrep_unavailable'))

    def test_invalid_pattern_is_separate_from_diagnostics(self):
        (self.root / 'allowed.txt').write_text('needle\n')
        proc, data = self.cli(pattern='[')
        self.assertEqual((proc.returncode, data['error']), (1, 'invalid_pattern'))
        self.assertNotIn('regex parse error', proc.stdout.decode())
        self.assertIn(b'regex parse error', proc.stderr)

    def test_empty_matches_are_successful_and_complete(self):
        (self.root / 'allowed.txt').write_text('needle\n')
        proc, data = self.cli(pattern='absent')
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(data['matches'], [])
        self.assertEqual(data['total'], 0)
        self.assertEqual(data['complete'], {'scan': True, 'display': True})

    def test_stderr_flood_cannot_deadlock_or_become_result_data(self):
        env = self.fake_rg("import sys\nsys.stderr.write('backend diagnostic\\n' * 20000)\nsys.stderr.flush()\nsys.exit(2)\n")
        for command in ('search', 'files'):
            with self.subTest(command=command):
                proc, data = self.cli(command, env=env)
                self.assertEqual((proc.returncode, data['error']), (1, 'ripgrep_failed'))
                self.assertNotIn('backend diagnostic', proc.stdout.decode())
                self.assertIn(b'backend diagnostic', proc.stderr)
                self.assertNotIn('matches', data)

    def test_backend_signal_is_not_success(self):
        env = self.fake_rg('import os, signal\nos.kill(os.getpid(), signal.SIGTERM)\n')
        proc, data = self.cli(env=env)
        self.assertEqual((proc.returncode, data['error']), (1, 'ripgrep_failed'))
        self.assertNotIn('matches', data)

    def test_late_failure_after_display_limit_is_not_success(self):
        event = {'type': 'match', 'data': {'path': {'text': str(self.root / 'allowed.txt')},
                 'lines': {'text': 'needle\n'}, 'line_number': 1,
                 'submatches': [{'match': {'text': 'needle'}, 'start': 0, 'end': 6}]}}
        env = self.fake_rg('import sys, json, time\nprint(' + repr(json.dumps(event)) + ', flush=True)\n'
                           "time.sleep(0.1)\nsys.stderr.write('late scan failure\\n')\nsys.exit(2)\n")
        proc, data = self.cli('search', 'needle', '--max-results', '1', env=env)
        self.assertEqual((proc.returncode, data['error']), (1, 'ripgrep_failed'))
        self.assertNotIn('matches', data)

    def test_truncated_json_stream_is_not_complete(self):
        env = self.fake_rg("print('{broken')\n")
        proc, data = self.cli(env=env)
        self.assertEqual((proc.returncode, data['error']), (1, 'ripgrep_failed'))

    def test_cli_interrupt_is_structured_and_reaps_backend(self):
        marker = self.root / 'started'
        env = self.fake_rg('import os, time\nfrom pathlib import Path\nPath(' + repr(str(marker)) +
                           ').write_text(str(os.getpid()))\ntime.sleep(30)\n')
        for sig in (signal.SIGINT, signal.SIGTERM):
            with self.subTest(signal=sig):
                marker.unlink(missing_ok=True)
                proc = subprocess.Popen([sys.executable, str(CLI), 'search', 'needle', '--root', str(self.root)],
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
                try:
                    deadline = time.monotonic() + 5
                    while not marker.exists() and time.monotonic() < deadline:
                        time.sleep(0.01)
                    self.assertTrue(marker.exists(), 'backend did not start')
                    child = int(marker.read_text())
                    proc.send_signal(sig)
                    out, err = proc.communicate(timeout=5)
                    self.assertNotIn(b'Traceback', err)
                    data = json.loads(out)
                    self.assertEqual((proc.returncode, data['error']), (1, 'ripgrep_failed'))
                    self.assertNotIn('matches', data)
                    with self.assertRaises(ProcessLookupError):
                        os.kill(child, 0)
                finally:
                    if proc.poll() is None:
                        proc.kill()
                        proc.communicate()
                    if marker.exists():
                        try:
                            os.kill(int(marker.read_text()), signal.SIGKILL)
                        except ProcessLookupError:
                            pass

    def test_ordinary_search_agrees_with_direct_rg(self):
        (self.root / 'allowed.txt').write_bytes('é needle needle\nother\nneedle\r\n'.encode())
        direct = subprocess.run(['rg', '--no-config', '--json', '-e', 'needle', '--', str(self.root)],
                                capture_output=True, check=True)
        expected = []
        for raw in direct.stdout.splitlines():
            event = json.loads(raw)
            if event['type'] == 'match':
                data = event['data']
                expected.append({'path': Path(data['path']['text']).relative_to(self.root).as_posix(),
                                 'line': data['line_number'], 'column': data['submatches'][0]['start'] + 1,
                                 'text': data['lines']['text'],
                                 'submatches': [{**m, 'match': m['match']['text']} for m in data['submatches']]})
        proc, data = self.cli('search', 'needle', '--all')
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(data['matches'], expected)

    def test_native_ignores_and_binary_detection_are_preserved(self):
        (self.root / '.ignore').write_text('ignored.txt\n')
        (self.root / 'ignored.txt').write_text('needle\n')
        (self.root / '.hidden.txt').write_text('needle\n')
        (self.root / 'binary.txt').write_bytes(b'\0needle\n')
        (self.root / 'allowed.txt').write_text('needle\n')
        proc, data = self.cli('search', 'needle', '--all')
        self.assertEqual(proc.returncode, 0)
        self.assertEqual([m['path'] for m in data['matches']], ['allowed.txt'])

    def test_unbounded_adapter_keeps_sensitive_denies(self):
        (self.root / 'allowed.txt').write_text('needle\n')
        for name in ('.env.local', 'signing.pem', 'id_rsa', 'key.key'):
            (self.root / name).write_text('needle\n')
        for command in ('search', 'files'):
            proc, data = self.cli(command, 'needle', '--all')
            self.assertEqual(proc.returncode, 0)
            paths = [m['path'] for m in data['matches']] if command == 'search' else data['files']
            self.assertEqual(paths, ['allowed.txt'])

    def test_files_limit_reports_complete_scan(self):
        for number in range(76):
            (self.root / f'{number}.txt').write_text('needle\n')
        proc, data = self.cli('files', 'unused', '--max-results', '3')
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(data['count'], 3)
        self.assertEqual(data['total'], 76)
        self.assertEqual(data['complete'], {'scan': True, 'display': False})

    def test_explicit_bound_conflicts_with_all(self):
        (self.root / 'allowed.txt').write_text('needle\n' * 76)
        proc, data = self.cli('search', 'needle', '--all', '--max-results', '3')
        self.assertEqual((proc.returncode, data['status']), (2, 'error'))

    def test_success_exit_without_rg_summary_is_not_complete(self):
        event = {'type': 'match', 'data': {'path': {'text': str(self.root / 'allowed.txt')},
                 'lines': {'text': 'needle\n'}, 'line_number': 1,
                 'submatches': [{'match': {'text': 'needle'}, 'start': 0, 'end': 6}]}}
        env = self.fake_rg('print(' + repr(json.dumps(event)) + ')\n')
        proc, data = self.cli(env=env)
        self.assertEqual((proc.returncode, data['error']), (1, 'ripgrep_failed'))
        self.assertNotIn('matches', data)

    def test_metrics_bound_is_an_observation_not_a_total(self):
        for name in ('a.txt', 'b.txt'):
            (self.root / name).write_text('needle\n')
        proc, data = self.cli('metrics', 'unused', '--max-results', '1')
        self.assertEqual(proc.returncode, 0)
        self.assertEqual((data['files_seen'], data['bytes_seen'], data['lines_seen']), (1, 7, 1))
        self.assertEqual(data['complete'], {'scan': False, 'display': True})
        self.assertNotIn('files', data)
        self.assertNotIn('total', data)


if __name__ == '__main__':
    unittest.main()
