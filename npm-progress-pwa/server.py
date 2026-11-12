#!/usr/bin/env python3
"""Tiny static server for the PWA. Usage: python server.py [port]   (default 8082)"""
import http.server, socketserver, sys, os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8082
os.chdir(os.path.dirname(os.path.abspath(__file__)))

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.webmanifest': 'application/manifest+json', '.js': 'text/javascript', '.woff2': 'font/woff2'}
    def end_headers(self):
        # sw.js and index.html must always be revalidated so updates are picked up
        if self.path.split('?')[0] in ('/', '/index.html', '/sw.js', '/manifest.webmanifest'):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True

with Server(('0.0.0.0', PORT), Handler) as httpd:
    print(f'Serving on http://localhost:{PORT}  (Ctrl+C to stop)')
    try: httpd.serve_forever()
    except KeyboardInterrupt: pass
