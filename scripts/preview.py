"""Serve the repository with caching disabled for the live preview."""
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class PreviewHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        super().end_headers()


root = Path(__file__).resolve().parent.parent
handler = partial(PreviewHandler, directory=str(root))
ThreadingHTTPServer(('0.0.0.0', int(os.environ.get('PORT', '3000'))), handler).serve_forever()
