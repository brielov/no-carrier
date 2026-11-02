"""Local server for NO CARRIER. Same as `python3 -m http.server`, but it tells
the browser not to cache, so a reload always gets every current file."""

import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


os.chdir(os.path.dirname(os.path.abspath(__file__)))
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
print(f"NO CARRIER: http://localhost:{port}")
ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler).serve_forever()
