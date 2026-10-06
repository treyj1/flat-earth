# Flat Earth website: local dev server that never caches, so edits show on reload.
#   python web/tools/serve.py [port]
import http.server, os, sys
os.chdir(os.path.join(os.path.dirname(__file__), '..'))
class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8791
print(f'Flat Earth site: http://localhost:{port}')
http.server.ThreadingHTTPServer(('', port), NoCache).serve_forever()
