"""Single-lab trusted sequencer. Only encrypted revision manifests and signed policies live here."""
import argparse
import hashlib
import hmac
import json
import re
import sqlite3
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HEX = re.compile(r"[0-9a-f]{64}")
ID = re.compile(r"[0-9a-f]{32}")

class Denied(Exception):
    def __init__(self, status, message):
        self.status = status
        super().__init__(message)

def require(ok, status, message):
    if not ok:
        raise Denied(status, message)

def token_hash(token):
    return hashlib.sha256(token.encode("ascii")).hexdigest()

def raw(row):
    return row.encode("utf-8")

def valid_b64(value, size):
    import base64
    if not isinstance(value, str) or len(value) != ((size + 2) // 3) * 4:
        return False
    try:
        decoded = base64.b64decode(value, validate=True)
    except ValueError:
        return False
    return len(decoded) == size and base64.b64encode(decoded).decode() == value

def init(db):
    with closing(sqlite3.connect(db)) as c:
        c.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS policies (n INTEGER PRIMARY KEY, digest TEXT UNIQUE, row TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS revisions (seq INTEGER PRIMARY KEY, id TEXT UNIQUE, epoch INTEGER, row TEXT NOT NULL);
        """)

def transact(db, bootstrap_hash, method, data, token):
    with closing(sqlite3.connect(db,timeout=10)) as c, c:
        c.execute("BEGIN" if method=="state" else "BEGIN IMMEDIATE")
        head=c.execute("SELECT n,digest,row FROM policies ORDER BY n DESC LIMIT 1").fetchone()
        if method=="state":
            require(head,404,"Uninitialized")
            require(json.loads(head[2])["policy"]["anchor"]==data["anchor"],403,"Wrong vault")
            return {"nonce":data["nonce"],"policies":[r[0] for r in c.execute("SELECT row FROM policies ORDER BY n")],
                    "revisions":[r[0] for r in c.execute("SELECT row FROM revisions ORDER BY seq")] if data.get("withRevisions",True) else []}
        require(method in ("policy","commit"),404,"Unknown operation")
        row=data["row"]
        require(isinstance(row,str) and len(raw(row))<=512*1024,413,"Record too large")
        obj=json.loads(row)
        digest=hashlib.sha256(raw(row)).hexdigest()
        if not head:
            require(method=="policy" and hmac.compare_digest(token_hash(token),bootstrap_hash),403,"Bootstrap denied")
            n=-1
            previous=""
        else:
            n,previous,old=head
            policy=json.loads(old)["policy"]
            require(data["head"]==previous,409,"Authorization changed; retry")
            if method=="commit":
                record=obj["record"]
                require(isinstance(record,dict) and set(record)=={"anchor","head","epoch","id","from","payload"},400,"Invalid revision")
                require(valid_b64(obj.get("sig"),3309),400,"Invalid signature encoding")
                author=policy["members"].get(record["from"])
                require(author and hmac.compare_digest(token_hash(token),author["cap"]),403,"Device revoked")
                require(record["epoch"]==n and record["head"]==previous and record["anchor"]==policy["anchor"],409,"Stale revision")
                require(ID.fullmatch(record["id"]),400,"Invalid revision id")
                existing=c.execute("SELECT row FROM revisions WHERE id=?",(record["id"],)).fetchone()
                if existing:
                    require(existing[0]==row,409,"Revision collision")
                else:
                    c.execute("INSERT INTO revisions(id,epoch,row) VALUES(?,?,?)",(record["id"],n,row))
                return {"digest":digest}
            new=obj["policy"]
            by=new["by"]
            authorized=policy["recovery"] if by=="recovery" else policy["members"][policy["admin"]]
            require(by in ("recovery",policy["admin"]) and hmac.compare_digest(token_hash(token),authorized["cap"]),403,"Management denied")
            require(new["anchor"]==policy["anchor"],400,"Vault changed")
            require(by=="recovery" or new["recovery"]==policy["recovery"],400,"Root rotation requires recovery")
        p=obj["policy"]
        require(p["n"]==n+1 and p["parent"]==previous and ID.fullmatch(p["anchor"]),409,"Wrong successor")
        require(0<len(p["members"])<=32 and p["admin"] in p["members"],400,"Invalid membership")
        if "keyLink" in p:
            require(n>=0 and valid_b64(p["keyLink"],60),400,"Invalid epoch key link")
        elif n>=0:
            require("keyLink" not in policy and p["n"]<256,409,"Upgrade client for further authorization changes")
        require(all(HEX.fullmatch(v["cap"]) for v in [p["recovery"],*p["members"].values()]),400,"Invalid device verifier")
        if n==-1: require(p["by"]=="recovery",400,"Invalid genesis")
        c.execute("INSERT INTO policies VALUES(?,?,?)",(p["n"],digest,row))
        return {"digest":digest}

class API(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_POST(self):
        try:
            n=int(self.headers.get("Content-Length","0"))
            require(0<n<=768*1024,413,"Request size")
            data=json.loads(self.rfile.read(n))
            token=self.headers.get("Authorization","").removeprefix("Bearer ")
            result=transact(self.server.db,self.server.bootstrap_hash,self.path.removeprefix("/"),data,token)
            status=200
        except Denied as e:
            status=e.status;result={"error":str(e)}
        except (KeyError,TypeError,ValueError,AttributeError):
            status=400;result={"error":"Invalid request"}
        except sqlite3.Error:
            status=503;result={"error":"Ledger unavailable"}
        body=json.dumps(result,separators=(",",":")).encode()
        self.send_response(status)
        self.send_header("Cache-Control","no-store")
        self.send_header("Content-Type","application/json")
        self.send_header("Content-Length",str(len(body)))
        self.end_headers()
        self.wfile.write(body)

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--db",required=True);parser.add_argument("--bootstrap-verifier",required=True)
    parser.add_argument("--port",type=int,default=30447)
    args=parser.parse_args()
    verifier=Path(args.bootstrap_verifier).read_text().strip()
    assert HEX.fullmatch(verifier)
    init(args.db)
    server=ThreadingHTTPServer(("127.0.0.1",args.port),API)
    server.db=args.db;server.bootstrap_hash=verifier
    print(server.server_address[1],flush=True)
    server.serve_forever()
