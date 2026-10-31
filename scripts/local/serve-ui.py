"""Local runtime HTTP host for a prebuilt institution UI; no compilation."""
import argparse,http.server,json,pathlib,urllib.request,urllib.error
p=argparse.ArgumentParser();p.add_argument('--directory',required=True);p.add_argument('--port',type=int,default=18081);p.add_argument('--backend',default='http://127.0.0.1:18080');args=p.parse_args()
root=pathlib.Path(args.directory).resolve()
class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw):super().__init__(*a,directory=str(root),**kw)
    def do_GET(self):
        if self.path.startswith(('/api/','/office/')):return self.proxy()
        requested=pathlib.Path(self.translate_path(self.path)).resolve()
        if not requested.is_relative_to(root):self.send_error(403);return
        if not requested.is_file() and '.' not in pathlib.Path(self.path.split('?')[0]).name:self.path='/index.html'
        super().do_GET()
    def do_POST(self):self.proxy()
    def do_PUT(self):self.proxy()
    def do_DELETE(self):self.proxy()
    def proxy(self):
        if not self.path.startswith(('/api/','/office/')):self.send_error(404);return
        size=int(self.headers.get('Content-Length','0'))
        if size>64*1024*1024:self.send_error(413);return
        body=self.rfile.read(size) if size else None
        headers={k:v for k,v in self.headers.items() if k.lower() in ('authorization','content-type','accept','cookie')}
        request=urllib.request.Request(args.backend+self.path,data=body,headers=headers,method=self.command)
        try:response=urllib.request.urlopen(request,timeout=30)
        except urllib.error.HTTPError as error:response=error
        except urllib.error.URLError:self.send_error(502,'Institution service is not ready');return
        with response:
            payload=response.read();self.send_response(response.status)
            for k,v in response.headers.items():
                if k.lower() not in ('transfer-encoding','content-length','connection','server','date'):self.send_header(k,v)
            self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload)
    def log_message(self,fmt,*values):
        # Do not log query strings, authorization, bodies or access tokens.
        pass
http.server.ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
