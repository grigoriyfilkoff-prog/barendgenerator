"""Run the local browser suite using installed Chrome; no Python packages needed."""
import argparse
import functools
import http.server
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import sys

sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--page', default='tests/suite.html')
args = parser.parse_args()
done = threading.Event()
results = []

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        if args and '404' in str(args):
            print(fmt % args, flush=True)

    def do_POST(self):
        if self.path == '/artifact/debug-mesh.json':
            (ROOT / 'tests' / 'debug-mesh.json').write_bytes(self.rfile.read(int(self.headers['Content-Length'])))
            self.send_response(200)
            self.end_headers()
            return
        artifacts = {
            '/artifact/body.stl': 'BMX_STREET_SLIDE_V0.9.0_default.stl',
        }
        if self.path in artifacts:
            directory = ROOT / 'exports'
            directory.mkdir(exist_ok=True)
            (directory / artifacts[self.path]).write_bytes(self.rfile.read(int(self.headers['Content-Length'])))
            self.send_response(200)
            self.end_headers()
            return
        if self.path != '/test-result':
            self.send_error(404)
            return
        data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        results.append(data)
        print(json.dumps(data, ensure_ascii=False), flush=True)
        self.send_response(200)
        self.end_headers()
        if data.get('done'):
            done.set()

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
chrome = Path(os.environ.get('PROGRAMFILES', r'C:\Program Files')) / 'Google/Chrome/Application/chrome.exe'
profile = tempfile.mkdtemp(prefix='BMX-CAD-test-')
url = f'http://127.0.0.1:{server.server_port}/{args.page}'
print(f'Browser tests: {url}', flush=True)
proc = subprocess.Popen([str(chrome), '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--enable-unsafe-swiftshader', f'--user-data-dir={profile}', url],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
try:
    if not done.wait(900):
        raise TimeoutError('Browser tests did not complete within 900 seconds')
finally:
    # Terminate only the isolated Chrome process tree created by this runner.
    subprocess.run(['taskkill', '/PID', str(proc.pid), '/T', '/F'], capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
    server.shutdown()
output = ROOT / 'tests' / ('ui-results.json' if 'ui.html' in args.page else 'default-results.json' if 'case=default' in args.page else 'half-step-results.json' if 'case=half' in args.page else 'mesh-repair-results.json' if 'mesh-repair.html' in args.page else 'last-results.json')
output.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
if any(item.get('error') or item.get('ok') is False for item in results):
    raise SystemExit(1)
