"""Own only the private test server, dashboard and local model children."""
import pathlib, subprocess, os, json, threading, time, socket, secrets, urllib.request
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
ROOT=pathlib.Path(__file__).resolve().parent
CONFIG=json.loads((ROOT/'config.json').read_text())
PORT=8766
token=secrets.token_hex(32)
model_token=secrets.token_hex(32)
children={}; logs=[]; stopping=threading.Event();shutdown_started=False
def available(port):
    with socket.socket() as sock:
        sock.settimeout(.5)
        return sock.connect_ex(('127.0.0.1',port))!=0
def launch(name,args,cwd):
    output=open(ROOT/'logs'/f'{name}.log','a',encoding='utf-8');logs.append(output)
    env=os.environ.copy();env['TMP']=env['TEMP']=str(ROOT/'temp');env['HF_HOME']=str(ROOT/'cache/huggingface')
    env['PATH']=str(ROOT/'runtime/node-v22.23.3-win-x64')+os.pathsep+env['PATH']
    if name=='companion':env['OPENAI_API_KEY']=model_token
    child=subprocess.Popen(args,cwd=cwd,env=env,stdin=subprocess.PIPE,stdout=output,stderr=subprocess.STDOUT,text=True,encoding='utf-8',creationflags=subprocess.CREATE_NO_WINDOW)
    children[name]=child
    (ROOT/'data/processes.json').write_text(json.dumps({k:p.pid for k,p in children.items()},indent=2))
def shutdown():
    global shutdown_started
    if shutdown_started:return
    shutdown_started=True
    stopping.set()
    # Pause/persist Minecraft jobs before stopping its network session.
    try:
        key=(ROOT/'data/dashboard-token').read_text()
        req=urllib.request.Request(f'http://127.0.0.1:{CONFIG["dashboardPort"]}/api/stop',data=b'{}',headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
        urllib.request.urlopen(req,timeout=3).close()
    except Exception:pass
    java=children.get('test-server')
    if java and java.poll() is None:
        try:java.stdin.write('stop\n');java.stdin.flush();java.wait(timeout=45)
        except Exception:java.terminate()
    for child in children.values():
        if child.poll() is None:
            child.terminate()
            try:child.wait(timeout=8)
            except subprocess.TimeoutExpired:child.kill()
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        if self.headers.get('Authorization')!='Bearer '+token:return self.reply(403,{'error':'Forbidden'})
        self.reply(200,{name:{'pid':p.pid,'running':p.poll() is None,'exitCode':p.poll()} for name,p in children.items()})
    def do_POST(self):
        if self.headers.get('Authorization')!='Bearer '+token:return self.reply(403,{'error':'Forbidden'})
        data=json.loads(self.rfile.read(min(int(self.headers.get('Content-Length',0)),4096)) or '{}')
        if self.path=='/stop':
            self.reply(200,{'ok':True});stopping.set()
        elif self.path=='/companion/start':
            companion=children.get('companion')
            if companion is None or companion.poll() is not None:
                if not available(8080):return self.reply(409,{'error':'Companion port 8080 is already in use'})
                launch('companion',[str(ROOT/'runtime/node-v22.23.3-win-x64/node.exe'),'main.js'],ROOT/'vendor/mindcraft')
            self.reply(200,{'ok':True,'url':'http://localhost:8080'})
        elif self.path=='/companion/stop':
            companion=children.get('companion')
            if companion and companion.poll() is None:companion.terminate()
            self.reply(200,{'ok':True})
        elif self.path=='/test-command' and 'test-server' in children:
            command=data.get('command','')
            if not isinstance(command,str) or '\n' in command or '\r' in command:return self.reply(400,{'error':'Single command only'})
            server=children['test-server']
            if server.poll() is not None:return self.reply(400,{'error':'Test server is stopped'})
            server.stdin.write(command+'\n');server.stdin.flush();self.reply(200,{'ok':True})
        else:self.reply(404,{'error':'Unknown route'})
    def reply(self,code,body):
        data=json.dumps(body).encode();self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
def main():
    # The local llama-server (~6.5 GB commit) can be left out for low-memory sessions:
    # config.json "model".enabled=false, or the env override AGENT_MODEL=off.
    model_enabled=CONFIG.get('model',{}).get('enabled',True) and os.environ.get('AGENT_MODEL','on').lower() not in ('off','0','false')
    ports=[PORT,CONFIG['dashboardPort']]+([8081] if model_enabled else [])
    if CONFIG['server']['host']=='127.0.0.1' and CONFIG['server']['port']==25569:ports.append(25569)
    for port in ports:
        if not available(port):raise RuntimeError(f'Port {port} is already in use; no existing service was stopped')
    for name in ('data','logs','temp'):
        (ROOT/name).mkdir(parents=True,exist_ok=True)
    (ROOT/'data/supervisor-token').write_text(token)
    (ROOT/'data/model-token').write_text(model_token)
    api=ThreadingHTTPServer(('127.0.0.1',PORT),Handler)
    threading.Thread(target=api.serve_forever,daemon=True).start()
    try:
        if 25569 in ports:launch('test-server',[str(ROOT.parent/'jdk25/bin/java.exe'),'-Xms512M','-Xmx2048M','-jar','paper.jar','nogui'],ROOT/'test-server')
        launch('dashboard',[str(ROOT/'runtime/node-v22.23.3-win-x64/node.exe'),str(ROOT/'src/app.js')],ROOT)
        if model_enabled:launch('model',[str(ROOT/'runtime/llama-cpp/llama-server.exe'),'-m',str(ROOT/'models/Qwen3-8B-Q4_K_M.gguf'),'--host','127.0.0.1','--port','8081','-ngl','99','-c','8192','-np','1','--alias','Qwen3-8B','--jinja','--reasoning','off','--api-key-file',str(ROOT/'data/model-token'),'--cors-origins',f'http://127.0.0.1:{CONFIG["dashboardPort"]}'],ROOT)
        else:print('model server disabled (config.model.enabled=false): skipping llama-server, saving ~6.5 GB commit',flush=True)
        while not stopping.wait(1):
            if all(p.poll() is not None for p in children.values()):break
    finally:shutdown();api.shutdown()
if __name__=='__main__':main()
