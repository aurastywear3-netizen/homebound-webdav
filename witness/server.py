"""Single-lab trusted sequencer. Only encrypted revision manifests and signed policies live here."""
import argparse
import base64
import hashlib
import hmac
import http.client
import json
import re
import sqlite3
import ssl
import time
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

HEX = re.compile(r"[0-9a-f]{64}")
DEVICE_LIMIT = 10
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
        CREATE TABLE IF NOT EXISTS features (name TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS pairing_invite (
            singleton INTEGER PRIMARY KEY CHECK(singleton=1), slot TEXT NOT NULL, expires INTEGER NOT NULL, code TEXT
        );
        CREATE TABLE IF NOT EXISTS pairing_application (slot TEXT PRIMARY KEY, envelope TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS revisions (seq INTEGER PRIMARY KEY, id TEXT UNIQUE, epoch INTEGER, row TEXT NOT NULL);
        """)

def unpack(row):
    require(isinstance(row,str) and len(raw(row))<=512*1024,413,"Record too large")
    obj=json.loads(row)
    require(isinstance(obj,dict),400,"Invalid record")
    return obj,hashlib.sha256(raw(row)).hexdigest()

def insert_policy(c,head,row,token,bootstrap_hash,rotation=False):
    obj,digest=unpack(row)
    p=obj["policy"]
    require(("revisionId" in p)==rotation,400,"Rotation requires the matching revision")
    n,previous,old=head if head else (-1,"",None)
    prior=json.loads(old)["policy"] if old else None
    if prior is None:
        require(not rotation and hmac.compare_digest(token_hash(token),bootstrap_hash),403,"Bootstrap denied")
        require(p["by"]=="recovery",400,"Invalid genesis")
    else:
        by=p["by"]
        authorized=prior["recovery"] if by=="recovery" else prior["members"][prior["admin"]]
        require(by in ("recovery",prior["admin"]) and hmac.compare_digest(token_hash(token),authorized["cap"]),403,"Management denied")
        require(p["anchor"]==prior["anchor"],400,"Vault changed")
        require(by=="recovery" or p["recovery"]==prior["recovery"],400,"Root rotation requires recovery")
        require(by=="recovery" or p["admin"]==prior["admin"],403,"Only recovery can replace the administrator")
    if rotation:
        require(p["by"]==prior["admin"]==p["admin"] and p["members"]==prior["members"] and
                "keyLink" in p and ID.fullmatch(p["revisionId"]),400,"Invalid admin revision policy")
        require(valid_b64(obj.get("sig"),3309),400,"Invalid policy signature encoding")
        boxes=p["boxes"]
        require(set(boxes)==set(p["members"]),400,"Missing recipient")
        recipients=[(boxes[k],prior["boxes"][k]) for k in p["members"]]
        for box,old_box in [*recipients,(p["recoveryBox"],prior["recoveryBox"])]:
            require(isinstance(box,list) and len(box)==3 and valid_b64(box[0],1088) and
                    valid_b64(box[1],12) and valid_b64(box[2],64),400,"Invalid recipient envelope")
            require(box[0]!=old_box[0] and box[2]!=old_box[2],400,"Reused recipient envelope")
    require(p["n"]==n+1 and p["parent"]==previous and ID.fullmatch(p["anchor"]),409,"Wrong successor")
    members=p["members"]
    require(isinstance(members,dict) and 0<len(members) and p["admin"] in members,400,"Invalid membership")
    # Older vaults can keep writing, revoke gradually, or recover. New identities cannot
    # enter an over-limit roster, even when an older client swaps out an existing member.
    if len(members)>DEVICE_LIMIT:
        require(prior is not None and members.keys()<=prior["members"].keys(),409,"Device limit reached")
    elif prior and p["by"]!="recovery" and len(prior["members"])>=DEVICE_LIMIT:
        require(members.keys()<=prior["members"].keys(),409,"Device limit reached")
    if "keyLink" in p:
        require(n>=0 and valid_b64(p["keyLink"],60),400,"Invalid epoch key link")
    elif prior:
        require("keyLink" not in prior and p["n"]<256,409,"Upgrade client for further authorization changes")
    require(all(HEX.fullmatch(v["cap"]) for v in [p["recovery"],*p["members"].values()]),400,"Invalid device verifier")
    c.execute("INSERT INTO policies VALUES(?,?,?)",(p["n"],digest,row))
    if not rotation:
        c.execute("DELETE FROM pairing_invite")
        c.execute("DELETE FROM pairing_application")
    return p,digest

def current_invite(c, slot):
    require(isinstance(slot,str) and ID.fullmatch(slot),400,"Invalid invitation")
    row=c.execute("SELECT code FROM pairing_invite WHERE slot=? AND expires>?",(slot,int(time.time()*1000))).fetchone()
    require(row is not None,410,"Invitation expired or replaced")
    return row[0]

def pair(c,head,data,token):
    require(head,403,"Uninitialized")
    action,slot=data["action"],data["slot"]
    require(isinstance(slot,str) and ID.fullmatch(slot),400,"Invalid invitation")
    if action in ("open","poll"):
        p=json.loads(head[2])["policy"]
        require(hmac.compare_digest(token_hash(token),p["members"][p["admin"]]["cap"]),403,"Management denied")
        if action=="open":
            require(data["head"]==head[1],409,"Authorization changed; retry")
            require(len(p["members"])<DEVICE_LIMIT,409,"Device limit reached")
            now=int(time.time()*1000)
            expires=data["expires"]
            require(type(expires) is int and now<expires<=now+11*60*1000,400,"Invalid expiration")
            active=c.execute("SELECT slot,expires FROM pairing_invite WHERE singleton=1").fetchone()
            if active!=(slot,expires):
                c.execute("DELETE FROM pairing_application")
                c.execute("INSERT OR REPLACE INTO pairing_invite VALUES(1,?,?,NULL)",(slot,expires))
            return {"opened":True}
        return application(c,slot,current_invite(c,slot))
    require(action=="claim",400,"Invalid invitation action")
    code=data["code"]
    require(isinstance(code,str) and ID.fullmatch(code),400,"Invalid request code")
    existing=current_invite(c,slot)
    if existing is None:
        if "envelope" in data:
            envelope=data["envelope"]
            encoded=json.dumps(envelope,separators=(",",":"))
            require(len(encoded)<32768 and envelope["request"]["invite"]==slot and
                    HEX.fullmatch(envelope["request"]["pub"]["davCap"]),400,"Invalid device application")
            c.execute("INSERT INTO pairing_application VALUES(?,?)",(slot,encoded))
        c.execute("UPDATE pairing_invite SET code=? WHERE singleton=1",(code,))
    return application(c,slot,existing or code)

def application(c,slot,code):
    row=c.execute("SELECT envelope FROM pairing_application WHERE slot=?",(slot,)).fetchone()
    return {"code":code,"envelope":json.loads(row[0])} if row else {"code":code}

def commit_revision(c,head,data,token,bootstrap_hash):
    require(head,403,"Uninitialized")
    obj,digest=unpack(data["row"])
    record=obj["record"]
    require(isinstance(record,dict) and set(record)=={"anchor","head","epoch","id","from","payload"},400,"Invalid revision")
    require(valid_b64(obj.get("sig"),3309) and ID.fullmatch(record["id"]),400,"Invalid revision signature or ID")
    n,previous,old=head
    policy=json.loads(old)["policy"]
    rotation="rotation" in data
    replay=rotation and data["rotation"]==old and data["head"]==policy["parent"] and policy.get("revisionId")==record["id"]
    if not replay:require(data["head"]==previous,409,"Authorization changed; retry")
    author=policy["members"].get(record["from"])
    require(author and hmac.compare_digest(token_hash(token),author["cap"]),403,"Device revoked")
    if rotation:
        require(record["from"]==policy["admin"],403,"Only an administrator can rotate on commit")
        # Exact retransmission after a lost response. Recheck the current authorization above.
        if replay:
            found=c.execute("SELECT row FROM revisions WHERE id=?",(record["id"],)).fetchone()
            require(found and found[0]==data["row"],409,"Revision collision")
            return {"digest":digest,"policyDigest":previous}
        policy,previous=insert_policy(c,head,data["rotation"],token,bootstrap_hash,rotation=True)
        n=policy["n"]
        require(record["id"]==policy["revisionId"],409,"Wrong revision for this rotation")
        c.execute("INSERT OR IGNORE INTO features VALUES('admin-revision-rotation')")
    elif record["from"]==policy["admin"]:
        active=c.execute("SELECT 1 FROM features WHERE name='admin-revision-rotation'").fetchone()
        require(not active,426,"Upgrade the administrator client for per-revision rotation")
    require(record["epoch"]==n and record["head"]==previous and record["anchor"]==policy["anchor"],409,"Stale revision")
    existing=c.execute("SELECT row FROM revisions WHERE id=?",(record["id"],)).fetchone()
    if existing:
        require(existing[0]==data["row"],409,"Revision collision")
    else:
        c.execute("INSERT INTO revisions(id,epoch,row) VALUES(?,?,?)",(record["id"],n,data["row"]))
    result={"digest":digest}
    if rotation:result["policyDigest"]=previous
    return result

def transact(db, bootstrap_hash, method, data, token, device_dav=False):
    with closing(sqlite3.connect(db,timeout=10)) as c, c:
        c.execute("BEGIN" if method=="state" else "BEGIN IMMEDIATE")
        head=c.execute("SELECT n,digest,row FROM policies ORDER BY n DESC LIMIT 1").fetchone()
        if method=="state":
            require(head,404,"Uninitialized")
            require(json.loads(head[2])["policy"]["anchor"]==data["anchor"],403,"Wrong vault")
            return {"nonce":data["nonce"],"adminRevisionRotation":1,"deviceLimit":DEVICE_LIMIT,"qrPairing":1,"deviceDav":int(device_dav),
                    "policies":[r[0] for r in c.execute("SELECT row FROM policies ORDER BY n")],
                    "revisions":[r[0] for r in c.execute("SELECT row FROM revisions ORDER BY seq")] if data.get("withRevisions",True) else []}
        if method=="commit":return commit_revision(c,head,data,token,bootstrap_hash)
        require(method=="policy",404,"Unknown operation")
        if "pairing" in data:
            return pair(c,head,data["pairing"],token)
        if head:require(data["head"]==head[1],409,"Authorization changed; retry")
        if "invitation" in data:
            invite=data["invitation"]
            require(ID.fullmatch(invite["code"]) and current_invite(c,invite["slot"])==invite["code"],409,"Different pairing request")
        _,digest=insert_policy(c,head,data["row"],token,bootstrap_hash)
        return {"digest":digest}

class API(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def proxy_object(self):
        upstream=getattr(self.server,"dav",None)
        path=self.path.removeprefix("/dav/")
        if not upstream or not self.path.startswith("/dav/") or not re.fullmatch(r"vault[.]json|(?:objects|requests)/[a-f0-9]{32}",path):
            return self.send_error(404)
        if self.command=="PUT" and not path.startswith("objects/"):
            return self.send_error(405)
        auth=self.headers.get("Authorization","")
        match=re.fullmatch(r"Bearer ([0-9a-f]{32})[.]([A-Za-z0-9+/]{43}=)",auth)
        if not match:return self.send_error(403)
        with closing(sqlite3.connect(self.server.db,timeout=10)) as conn:
            row=conn.execute("SELECT row FROM policies ORDER BY n DESC LIMIT 1").fetchone()
        policy=json.loads(row[0])["policy"] if row else {}
        member=policy.get("members",{}).get(match[1],{})
        if not hmac.compare_digest(member.get("davCap",""),token_hash(match[2])):
            return self.send_error(403)
        if path.startswith("requests/") and policy.get("admin")!=match[1]:
            return self.send_error(403)
        length=self.headers.get("Content-Length","")
        if self.command=="PUT" and (not length.isdecimal() or len(length)>12 or self.headers.get("Transfer-Encoding")):
            return self.send_error(411)
        endpoint,credentials,context=upstream
        conn=http.client.HTTPSConnection(endpoint.hostname,endpoint.port,context=context,timeout=60)
        headers_sent=False
        try:
            conn.putrequest(self.command,endpoint.path.rstrip("/")+"/"+path)
            conn.putheader("Authorization",credentials)
            if self.command=="PUT":
                conn.putheader("Content-Length",length)
                conn.putheader("Content-Type","application/octet-stream")
            conn.endheaders()
            remaining=int(length) if self.command=="PUT" else 0
            while remaining:
                chunk=self.rfile.read(min(remaining,65536))
                if not chunk:raise OSError("Incomplete upload")
                conn.send(chunk);remaining-=len(chunk)
            response=conn.getresponse()
            # Never redirect a device credential, or forward storage authentication details.
            if response.status not in (200,201,204,404,409,412,413,423,507):
                return self.send_error(502)
            self.send_response(response.status);self.send_header("Cache-Control","no-store")
            self.send_header("Content-Type","application/octet-stream")
            if response.length is not None:self.send_header("Content-Length",str(response.length))
            self.end_headers();headers_sent=True
            while chunk:=response.read(65536):self.wfile.write(chunk)
        except (OSError,http.client.HTTPException):
            if not headers_sent:self.send_error(502)
            self.close_connection=True
        finally:conn.close()
    do_GET=do_PUT=proxy_object
    def do_POST(self):
        try:
            n=int(self.headers.get("Content-Length","0"))
            # A rotating commit carries two separately bounded signed rows.
            limit=2*768*1024 if self.path=="/commit" else 768*1024
            require(0<n<=limit,413,"Request size")
            data=json.loads(self.rfile.read(n))
            token=self.headers.get("Authorization","").removeprefix("Bearer ")
            result=transact(self.server.db,self.server.bootstrap_hash,self.path.removeprefix("/"),data,token,bool(self.server.dav))
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
    parser.add_argument("--webdav-config",type=Path,help="Optional per-vault HTTPS storage configuration for passwordless QR enrollment")
    args=parser.parse_args()
    verifier=Path(args.bootstrap_verifier).read_text().strip()
    assert HEX.fullmatch(verifier)
    init(args.db)
    server=ThreadingHTTPServer(("127.0.0.1",args.port),API)
    server.db=args.db;server.bootstrap_hash=verifier
    server.dav=None
    if args.webdav_config:
        cfg=json.loads(args.webdav_config.read_text())
        endpoint=urlsplit(cfg["url"])
        if endpoint.scheme!="https" or not endpoint.hostname or endpoint.username or endpoint.password or endpoint.query or endpoint.fragment:
            parser.error("webdav-config requires a fixed HTTPS storage URL")
        credentials=base64.b64encode((cfg["username"]+":"+cfg["password"]).encode()).decode()
        server.dav=(endpoint,"Basic "+credentials,ssl.create_default_context(cafile=cfg.get("caFile")))
    print(server.server_address[1],flush=True)
    server.serve_forever()
