"use strict";
const {Setting,Modal,Notice,Platform,requestUrl}=require("obsidian");
const core=require("./core.cjs");
const pq=require("./pqc.cjs");
const {Dav,VaultFiles,credentials}=require("./adapter.cjs");
const folder="Homebound-PQC";
const namespace="pqc-preview-2";
const notice=e=>new Notice(e.message||String(e),10000);
const invites=require("./pairing-invite.cjs");
const pairingUI=require("./pairing-ui.cjs");
const { ConflictModal } = require("./pqc-conflict.cjs");
class Output extends Modal {
    constructor(app,title,value){super(app);this.title=title;this.value=value;}
    onOpen(){
        this.setTitle(this.title);
        const t=this.contentEl.createEl("textarea");t.readOnly=true;t.value=this.value;t.rows=4;t.style.width="100%";
        new Setting(this.contentEl).addButton(b=>b.setButtonText("复制").onClick(()=>navigator.clipboard.writeText(this.value).catch(notice)));
    }
    onClose(){this.value="";this.contentEl.empty();}
}
function displaySettings(el,p,app,redraw){
        const c={...p.config};let password="",code="",request="",recovery="",bootstrap="";
        const field=(label,value,change,secret=false)=>new Setting(el).setName(label).addText(t=>{
            t.setValue(value).onChange(change);if(secret)t.inputEl.type="password";
        });
        const button=(label,fn,refresh=true)=>new Setting(el).addButton(b=>b.setButtonText(label).onClick(async()=>{
            try{const result=await p.exclusive(fn);if(refresh)redraw();if(result?.title)new Output(app,result.title,result.value).open();}
            catch(e){if(refresh)redraw();notice(e);}
        }));
        el.createEl("p",{text:"PQC 远端目录："+folder});
        field("WebDAV 地址",c.address,v=>c.address=v);
        if(!c.deviceDav){
            field("WebDAV 用户名",c.username,v=>c.username=v);
            field("WebDAV 密码（留空沿用）","",v=>password=v,true);
        }
        field("这台设备的名称",c.name,v=>c.name=v);
        button("保存连接设置",async()=>{
            await p.configure(c,password);
            new Notice("连接设置已保存。");
        },false);
        if(p.config.anchor)el.createEl("p",{text:"库指纹："+p.config.anchor});
        if(!p.config.anchor){
            pairingUI.scanButton(el,invite=>pairingUI.join(app,invite,fields=>p.exclusive(()=>p.joinInvite(invite,fields)),redraw));
            field("建库授权（服务部署者提供）","",v=>bootstrap=v,true);
            button("创建 PQC 库",async()=>{
                let token=bootstrap.trim();
                if(!token)throw Error("请先填写此库的建库授权，再点创建 PQC 库。");
                await p.configure(c,password);
                const seed=pq.freshSeed();
                // Save the recovery material before creating the remote vault.
                const out=new Output(app,"先离线保存恢复码，然后确认创建",seed);
                const previous=out.onOpen.bind(out);
                out.onOpen=()=>{
                    previous();
                    let correction;
                    const confirm=new Setting(out.contentEl);
                    confirm.addButton(b=>b.setButtonText("我已保存，创建").onClick(async()=>{
                        try{
                            await p.exclusive(()=>p.create(seed,token));
                            out.close();redraw();
                        }catch(e){
                            if(e.code==="bootstrap-denied" && !correction){
                                correction=new Setting(out.contentEl).setName("重新填写建库授权").addText(t=>{
                                    t.inputEl.type="password";t.inputEl.autocomplete="off";
                                    t.onChange(value=>{token=value.trim();});
                                    t.inputEl.focus();
                                });
                                confirm.settingEl.before(correction.settingEl);
                            }
                            notice(e);
                        }
                    }));
                };
                out.open();
            },false);
            field("从管理员设备 核对的库指纹","",v=>code=v);
            button("申请配对",async()=>({title:"请在管理员设备 输入此配对码",value:await p.request(code.trim())}));
        }
        if(p.config.request){
            el.createEl("p",{text:"本设备配对码（10 分钟有效）："+p.config.request});
            if(p.config.firstApplication)button("放弃本机待批申请",()=>p.forgetApplication());
        }
        if(p.config.anchor && !p.config.admin){
            if(p.config.deviceDav && !p.config.roster?.length)
                pairingUI.scanButton(el,invite=>pairingUI.join(app,invite,fields=>p.exclusive(()=>p.joinInvite(invite,fields)),redraw));
            if(!p.config.deviceDav)button("重新申请配对",async()=>({title:"新配对码",value:await p.request(p.config.anchor)}));
        }
        if(p.config.integrity)el.createEl("p",{text:p.config.integrity});
        if(p.config.anchor){
            pairingUI.devices(el,p,app,redraw);
            button("立即同步 / 检查配对",async()=>{const r=await p.sync();new Notice(p.syncSummary(r));});
            for (const path of p.conflicts) {
                new Setting(el).setName(path).addButton(b => b.setButtonText("比较冲突副本").onClick(() => p.compare(path, redraw)));
            }
            if(p.config.admin){
                button("重新校验恢复数据",()=>p.verifyRecovery());
                field("新设备显示的配对码","",v=>request=v);
                button("批准已核对的配对码",()=>p.approve(request.trim()));

            }
        }
        field("离线恢复码","",v=>recovery=v,true);
        button("用恢复码接管，撤销原设备",async()=>{
            const saved=p.pendingRecovery(),replacement=saved||pq.freshSeed();
            const kit=await p.replacementKit(recovery.trim(),replacement);
            const modal=new Output(app,"先离线保存新恢复码。确认后旧码、原设备均会失效。",kit);
            const open=modal.onOpen.bind(modal);
            modal.onOpen=()=>{open();
            new Setting(modal.contentEl).addButton(b=>b.setButtonText("确认恢复").onClick(async()=>{
                try{await p.exclusive(()=>p.restore(recovery.trim(),replacement));modal.close();redraw();}catch(e){notice(e);}
            }));};modal.open();
        });
    }
class PqcMode{
    constructor(app, transfer){
        this.transfer=transfer;
        this.app=app;
        this.conflicts=[];
        const saved=app.loadLocalStorage("homebound-webdav-pqc-config");
        if(saved && saved.format!==2)throw Error("无法识别此设备的 PQC 配置。");
        this.config={format:2,home:"",away:"",witness:"",username:"",name:"我的设备",...saved};
        this.config.address=core.gatewayAddress(this.config);
        if(!this.config.local){this.config.local=core.randomId();this.saveData(this.config);}
    }
    saveData(data){this.app.saveLocalStorage("homebound-webdav-pqc-config",data);}
    display(el,redraw){displaySettings(el,this,this.app,redraw);}
    async exclusive(fn){if(this.closed)throw Error("PQC 模式已关闭。");if(this.busy)throw Error("操作进行中。");this.busy=true;try{return await fn();}finally{this.busy=false;this.transfer?.progress(null);}}
    secret(k,v){
        const s=this.app.secretStorage,id="hbpqc-"+this.config.local+"-"+k;
        if(v!==undefined)s.setSecret(id,v);
        return s.getSecret(id);
    }
    ledgerAddress(address){
        const base=core.gatewayUrl(address);
        if(this.config.anchor){
            // Existing devices trust a particular service. Keep its exact URL and trust boundary.
            const pinned=core.gatewayUrl(this.config.witness);
            if(new URL(base).origin!==new URL(pinned).origin)
                throw Error("此库已绑定可信提交服务。请使用该服务所在的 HTTPS 网关，并在同一网关转发 WebDAV。");
            return pinned;
        }
        return this.config.inviteLedger && this.config.address===base ? this.config.inviteLedger : base+"/homebound-pqc-ledger";
    }
    bindAnchor(anchor){
        if(this.config.anchor===anchor)return;
        if(this.config.anchor)throw Error("库指纹不匹配。");
        this.config.witness=this.ledgerAddress(this.config.address);
        delete this.config.inviteLedger;
        this.config.anchor=anchor;
    }
    async configure(c,password){
        const address=core.gatewayUrl(c.address), witness=this.ledgerAddress(address);
        // Older plugin versions can open the same gateway and use their original secret IDs.
        Object.assign(this.config,{address,home:address,away:address,witness,name:c.name.trim(),username:c.username.trim()});
        if(this.config.inviteLedger && this.config.inviteLedger!==witness)delete this.config.inviteLedger;
        if(password)this.secret("dav",password);await this.saveData(this.config);
    }
    async device(){
        if(!this.keys){let seed=this.secret("device");if(!seed){seed=pq.freshSeed();this.secret("device",seed);}this.keys=await pq.identity(seed,"device");}
        return this.keys;
    }
    base(){
        const address=core.gatewayUrl(this.config.address);
        this.ledgerAddress(address);
        return new Dav(address,credentials(this.config.username,this.secret("dav")));
    }
    async route(){
        let dav;
        if(this.config.deviceDav){
            const device=await this.device();
            dav=new Dav(this.ledgerAddress(this.config.address)+"/dav","Bearer "+device.id+"."+device.davToken);
        }else dav=this.base().child(folder).child(namespace);
        let timer;
        try{
            const bytes=await Promise.race([dav.read("vault.json"),new Promise((_,reject)=>{
                timer=setTimeout(()=>reject(Error("WebDAV 网关连接超时。")),16000);
            })]);
            return {dav,marker:core.parseBytes(bytes),route:"WebDAV"};
        }finally{clearTimeout(timer);}
    }
    async create(seed,bootstrap){
        const rec=await pq.identity(seed,"recovery"), dev=await this.device(), home=this.base(), dir=home.child(folder);
        try{await home.mkdir(folder);}catch(e){if(e.status!==405)throw e;}
        const known=await dir.list();
        if(known.some(x=>x!==namespace))throw Error("新测试目录包含其他文件。");
        const dav=dir.child(namespace);
        if(!known.length)await dir.mkdir(namespace);
        try{
            const marker=core.parseBytes(await dav.read("vault.json"));
            if(marker.format!==2||marker.anchor!==rec.id)throw Error("此 WebDAV 目录已有 PQC 库，请用库指纹配对或选择新库地址。");
        }catch(e){if(e.status!==404)throw e;}
        for(const name of ["objects","requests"])try{await dav.mkdir(name);}catch(e){if(e.status!==405)throw e;}
        let live;
        try{live=await pq.state(this.ledger.bind(this),rec.id);}catch(e){if(!e.uninitialized)throw e;}
        if(live){
            if(live.policies.length!==1||pq.latest(live).p.admin!==dev.id)throw Error("服务已绑定到另一管理员。");
        }else{
            const token=(bootstrap||"").trim();
            if(!token)throw Object.assign(Error("请填写此库的建库授权后再确认创建。"),{code:"bootstrap-denied"});
            await pq.genesis(this.ledger.bind(this),dev,this.config.name,rec,token);
        }
        const marker=core.jsonBytes({format:2,anchor:rec.id}).buffer;
        try{
            await dav.call("PUT","vault.json",[200,201,204],{body:marker,contentType:"application/octet-stream",headers:{"If-None-Match":"*"}});
        }catch(e){
            if(e.status!==412)throw e;
            const current=core.parseBytes(await dav.read("vault.json"));
            if(current.format!==2||current.anchor!==rec.id)throw Error("此 WebDAV 目录已绑定其他 PQC 库。");
        }
        this.bindAnchor(rec.id);await this.refresh();return rec.id;
    }
    async ledger(method,data,token,endpoint=this.ledgerAddress(this.config.address)){
        const nonce=core.randomId(), headers={"Cache-Control":"no-store"};
        if(token)headers.Authorization="Bearer "+token;
        const response=await requestUrl({url:endpoint+"/"+method,method:"POST",headers,
            contentType:"application/json",body:JSON.stringify({...data,transportNonce:nonce}),throw:false});
        if(response.status!==200){
            let detail;try{detail=response.json;}catch{}
            if(response.status===403 && method==="policy" && detail?.error==="Bootstrap denied"){
                throw Object.assign(Error("建库授权不正确。请重新粘贴此库的建库授权，再点确认创建。"),{status:403,code:"bootstrap-denied"});
            }
            if(response.status===403 && method==="state" && detail?.error==="Wrong vault"){
                throw Object.assign(Error("此提交服务已绑定其他库指纹。请核对 WebDAV 地址中的库路径。"),{status:403});
            }
            if(method==="state" && response.status===404){
                if(detail?.error==="Uninitialized")throw Object.assign(Error("此提交服务尚未建库。"),{status:404,uninitialized:true});
                throw Error("此 WebDAV 地址尚未配置 PQC 提交服务，请检查网关路径。");
            }
            if(response.status===409 && detail?.error==="Device limit reached")throw Error("此库最多授权 10 台设备（含管理员），请先撤销一台。");
            if(response.status===410)throw Error("邀请已过期或已被新二维码替换，请管理员重新显示二维码。");
            const msg=({403:"未获授权、已撤销或恢复码失效",404:"请求不存在",409:"授权已变化，请重新同步或配对",426:"管理员逐修订换钥需要升级插件和可信提交服务"})[response.status]||"可信提交服务不可用";
            throw Object.assign(Error(msg+" ("+response.status+")"),{status:response.status});
        }
        return response.json;
    }
    async snapshot(anchor=this.config.anchor,withRevisions=true){return pq.state(this.ledger.bind(this),anchor,this.config.pin,withRevisions);}
    async context(anchor=this.config.anchor,withRevisions=true){
        const s=await this.snapshot(anchor,withRevisions);
        if(this.config.deviceDav && !pq.latest(s).p.members[(await this.device()).id]){
            await this.refresh(s);
            throw Error("此设备未获授权，或已被撤销。请在设置中重新申请配对。");
        }
        const r=await this.route();
        const marker=r.marker;
        if(marker.format!==2||marker.anchor!==anchor)throw Error("WebDAV 地址指向另一个库。");
        return {...r,s,device:await this.device()};
    }
    rememberDevices(s,dev){
        const {p,digest}=pq.latest(s);
        this.config.pin={n:p.n,digest};this.config.admin=p.admin===dev.id;
        delete this.config.others;
        this.config.roster=p.members[dev.id] ? Object.entries(p.members).map(([id,m])=>({
            id,name:m.name,admin:id===p.admin,self:id===dev.id
        })).sort((a,b)=>Number(b.admin)-Number(a.admin)) : [];
        if(p.members[dev.id]){delete this.config.request;delete this.config.firstApplication;}
    }
    async refresh(snapshot){
        const s=snapshot||await this.snapshot(this.config.anchor,false);
        this.rememberDevices(s,await this.device());
        await this.saveData(this.config);
    }
    async request(anchor){
        if(this.config.anchor&&this.config.anchor!==anchor)throw Error("库指纹不匹配。");
        const {dav,s,device}=await this.context(anchor,false);
        if(pq.latest(s).p.members[device.id])throw Error("这台设备已获授权，可以直接同步。");
        const code=await pq.requestPair(dav,s,device,this.config.name);
        this.bindAnchor(anchor);this.config.request=code;await this.refresh();return code;
    }
    async inviteDevice(){
        const {s,device}=await this.context(this.config.anchor,false), {p}=pq.latest(s);
        if(p.admin!==device.id)throw Error("只有当前管理员可以邀请设备。");
        if(Object.keys(p.members).length>=pq.deviceLimit)throw Error("设备已满，请先撤销一台。");
        if(!s.canInvite||!s.deviceDav)throw Error("请先为本库启用免填扫码服务，或使用手动配对码。");
        const address=this.config.address;
        const invite=invites.create(address,this.ledgerAddress(address),s);
        await this.ledger("policy",{pairing:{action:"open",slot:invite.slot,expires:invite.expires,head:pq.latest(s).digest}},device.token);
        return invite;
    }
    checkInvite(invite,s){
        if(Date.now()>=invite.expires || pq.membershipHead(s).digest!==invite.head)
            throw Error("邀请已过期或授权名单已变化，请重新扫码。");
    }
    async joinInvite(invite){
        if(!invite.automatic)throw Error("请让管理员重新显示免填二维码。");
        if(this.config.anchor && this.config.anchor!==invite.anchor)throw Error("此本地库已绑定其他 PQC 库。");
        if(this.config.anchor && (this.config.address!==invite.address || this.config.witness!==invite.ledger))
            throw Error("邀请与本地库已绑定的服务不匹配。");
        const ledger=(method,data)=>this.ledger(method,data,undefined,invite.ledger);
        const s=await pq.state(ledger,invite.anchor,this.config.anchor?this.config.pin:undefined,false);
        this.checkInvite(invite,s);
        if(!s.deviceDav)throw Error("此库的网关尚未启用免填扫码。");
        const device=await this.device(),policy=pq.latest(s).p;
        if(policy.members[device.id])throw Error("本机已获授权，可以直接同步。");
        if(Object.keys(policy.members).length>=pq.deviceLimit)throw Error("设备已满，请管理员先撤销一台。");
        const tablet=Platform.isIosApp && (/iPad/.test(navigator.userAgent)||navigator.maxTouchPoints>1 && /Mac/.test(navigator.platform));
        const platform=tablet?"iPad":Platform.isIosApp?"iPhone":Platform.isAndroidApp?"Android":Platform.isMacOS?"Mac":Platform.isWin?"Windows":"电脑";
        const name=platform+" · "+device.id.slice(-6);
        const {code,envelope}=await pq.signedRequest(s,device,name,invite);
        const receipt=await ledger("policy",{pairing:{action:"claim",slot:invite.slot,code,envelope}});
        const target=receipt.envelope && await pq.checkRequest(s,receipt.code,receipt.envelope);
        if(!target || target.id!==device.id || target.invite!==invite.slot || target.pub.davCap!==device.davCap)
            throw Error("此邀请已被使用，请管理员显示新码。");
        if(!this.config.anchor)this.config.firstApplication=true;
        Object.assign(this.config,{address:invite.address,home:invite.address,away:invite.address,witness:invite.ledger,
            anchor:invite.anchor,deviceDav:true,name:target.pub.name,request:receipt.code,username:""});
        delete this.config.inviteLedger;
        await this.refresh(s);
        return receipt.code;
    }
    async forgetApplication(){
        if(!this.config.firstApplication)return;
        for(const key of ["firstApplication","request","anchor","pin","roster","deviceDav"])delete this.config[key];
        // A late approval of the abandoned request must not grant the next enrollment this identity.
        this.secret("device","");this.config.local=core.randomId();this.keys=undefined;
        Object.assign(this.config,{address:"",home:"",away:"",witness:"",admin:false});
        await this.saveData(this.config);
    }
    async invitedRequest(invite){
        if(Date.now()>=invite.expires)throw Error("邀请已过期。");
        const device=await this.device();
        const {code,envelope}=await this.ledger("policy",{pairing:{action:"poll",slot:invite.slot}},device.token);
        if(!code)return null;
        const s=await this.snapshot(this.config.anchor,false);
        this.checkInvite(invite,s);
        const target=invite.automatic ? await pq.checkRequest(s,code,envelope) : await pq.readRequest((await this.route()).dav,s,code);
        if(target.invite!==invite.slot)throw Error("申请与该二维码不匹配。");
        return {code,name:target.pub.name};
    }
    async approve(code,invite){
        const {dav,s,device}=await this.context(this.config.anchor,false);
        let target;
        if(invite?.automatic){
            const receipt=await this.ledger("policy",{pairing:{action:"poll",slot:invite.slot}},device.token);
            if(receipt.code!==code || !receipt.envelope)throw Error("申请已变化，请重新核对。");
            target=await pq.checkRequest(s,code,receipt.envelope);
        }else target=await pq.readRequest(dav,s,code);
        if(invite){
            this.checkInvite(invite,s);
            if(target.invite!==invite.slot)throw Error("申请与该二维码不匹配。");
        }
        await pq.nextPolicy(this.ledger.bind(this),s,device,"approve",target);await this.refresh();return target.id;
    }
    async sealHistory(){await this.change("seal-history");}
    async revoke(id){await this.change("revoke",id);}
    async change(action,arg){
        await pq.nextPolicy(this.ledger.bind(this),await this.snapshot(this.config.anchor,false),await this.device(),action,arg);
        await this.refresh();
    }
    pendingRecovery(){return this.secret("pending-root")||"";}
    async recoveryKit(input){
        const fields=input.split(".");
        if(fields.length>2)throw Error("无效的恢复包。");
        const rec=await pq.identity(fields.at(-1),"recovery");
        const anchor=fields.length===1?rec.id:fields[0];
        if(!/^[a-f0-9]{32}$/.test(anchor)||(this.config.anchor&&this.config.anchor!==anchor))throw Error("恢复身份与本库不符。");
        return {anchor,rec};
    }
    async replacementKit(input,seed){const {anchor}=await this.recoveryKit(input);return anchor+"."+seed;}
    async restore(input,replacement){
        const {rec,anchor}=await this.recoveryKit(input),s=await this.snapshot(anchor,false);
        if(!replacement || replacement===input.split(".").at(-1))throw Error("请离线保存新的随机恢复码。");
        const newRoot=await pq.identity(replacement,"recovery");
        const existing=this.pendingRecovery(),pending=this.secret("pending-device");
        const resume=existing===replacement && pending && await pq.publicId(pq.latest(s).p.recovery)===newRoot.id;
        if(!resume && await pq.publicId(pq.latest(s).p.recovery)!==rec.id)throw Error("恢复身份已失效。");
        const seed=(existing===replacement && pending)||pq.freshSeed();
        const dev=await pq.identity(seed,"device");
        this.secret("pending-device",seed);this.secret("pending-root",replacement);
        if(!resume){
            await pq.nextPolicy(this.ledger.bind(this),s,rec,"restore",{id:dev.id,pub:pq.publicDevice(dev,this.config.name),recovery:newRoot.pub});
        }else if(pq.latest(s).p.admin!==dev.id)throw Error("恢复事务与当前管理员不符。");
        this.secret("device",seed);this.keys=dev;this.bindAnchor(anchor);
        this.config.integrity="管理员已接管，尚未完成数据校验。";
        await this.refresh();this.secret("pending-root","");this.secret("pending-device","");
        return this.verifyRecovery();
    }
    async verifyRecovery(){
        let report;
        try{
            const {s,dav,device}=await this.context();
            const store=await pq.storeFor(this.ledger.bind(this),dav,s,device,this.transfer);
            report=await pq.auditData(store);
            this.config.integrity=report.faults.length?"已接管，数据不完整："+report.faults.map(f=>f.path+" ["+f.id+"]").join("，"):"已校验 "+report.checked+" 条历史修订及对应正文。";
        }catch(e){this.config.integrity="已接管，数据校验失败："+e.message;report={faults:[{path:e.path,id:e.id,error:e.message}]};}
        await this.saveData(this.config);return report;
    }
    syncSummary(r) {
        const lines = [r.route + " · 上传 " + r.sent + " · 下载 " + r.received];
        if (r.conflicts.length) lines.push("待解决冲突 " + r.conflicts.length + " 项 · 在插件设置中比较副本");
        return lines.join("\n");
    }
    async compare(path, redraw) {
        try {
            const review = await this.exclusive(async () => {
                const {store} = await this.syncStore();
                const heads = core.headsByPath(await store.history()).get(path) || [];
                if (new Set(heads.map(r => r.hash)).size < 2) throw Error("此冲突已变化，请重新同步。");
                const local = new VaultFiles(this.app);
                if (!core.safePath(path) || !local.allowed(path)) throw Error("无效的笔记路径。");
                const bytes = await local.read(path);
                const localHash = bytes === null ? null : await core.sha(bytes);
                const choices = [];
                if (!heads.some(r => r.hash === localHash) && bytes !== null) {
                    choices.push({source:"local", label:"本机当前正文", bytes});
                }
                for (const rev of heads) {
                    const here = rev.hash === localHash;
                    const label = (rev.author || "设备") + " · " + rev.id.slice(0,8) + (here ? "（本机当前）" : "");
                    const body = here ? bytes : rev.hash === null ? null : await store.readBody(rev);
                    choices.push({source:rev.id, label, bytes:body});
                }
                return {path, localHash, headIds:heads.map(r => r.id).sort(), choices};
            });
            if (!this.closed) new ConflictModal(this.app, review, async source => {
                const {path, localHash, headIds} = review;
                const r = await this.exclusive(() => this.sync({path, localHash, headIds, source}));
                new Notice(this.syncSummary(r));
                redraw?.();
            }).open();
        } catch (e) { notice(e); }
    }
    async syncStore(){
        const {dav,device,s,route}=await this.context(),last=pq.latest(s);
        if(!last.p.members[device.id]){
            await this.refresh(s);
            throw Error("此设备未获授权，或已被撤销。请在设置中重新申请配对。");
        }
        const store=await pq.storeFor(this.ledger.bind(this),dav,s,device,this.transfer,async(n,digest)=>{
            this.config.pin={n,digest};await this.saveData(this.config);
        });
        this.rememberDevices(s,device);
        await this.saveData(this.config);
        return {store, route};
    }
    async sync(selection){
        const {store, route} = await this.syncStore();
        const id="hbpqc-baseline-"+this.config.anchor;
        const r=await core.synchronize({store,local:new VaultFiles(this.app),baseline:new Map(this.app.loadLocalStorage(id)||[]),
            cache:new Map(),selection,checkpoint:m=>this.app.saveLocalStorage(id,[...m]),active:()=>!this.closed});
        this.conflicts = r.conflicts;
        return {route,sent:r.sent,received:r.received,conflicts:r.conflicts};
    }
}
module.exports=PqcMode;
