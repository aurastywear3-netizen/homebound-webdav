"use strict";
const {Plugin,PluginSettingTab,Setting,Modal,Notice,requestUrl}=require("obsidian");
const core=require("./core.cjs");
const pq=require("./pqc.cjs");
const {Dav,VaultFiles,credentials}=require("./adapter.cjs");
const folder="Homebound-PQC-Beta2";
const namespace="pqc-preview-2";
const notice=e=>new Notice(e.message||String(e),10000);
class Output extends Modal {
    constructor(app,title,value){super(app);this.title=title;this.value=value;}
    onOpen(){
        this.setTitle(this.title);
        const t=this.contentEl.createEl("textarea");t.readOnly=true;t.value=this.value;t.rows=4;t.style.width="100%";
        new Setting(this.contentEl).addButton(b=>b.setButtonText("复制").onClick(()=>navigator.clipboard.writeText(this.value).catch(notice)));
    }
    onClose(){this.value="";this.contentEl.empty();}
}
class Settings extends PluginSettingTab {
    constructor(app,p){super(app,p);this.p=p;}
    display(){
        const p=this.p,el=this.containerEl;el.empty();
        const c={...p.config};let password="",code="",request="",recovery="",bootstrap="";
        const field=(label,value,change,secret=false)=>new Setting(el).setName(label).addText(t=>{
            t.setValue(value).onChange(change);if(secret)t.inputEl.type="password";
        });
        const button=(label,fn)=>new Setting(el).addButton(b=>b.setButtonText(label).onClick(async()=>{
            try{const result=await p.exclusive(fn);this.display();if(result?.title)new Output(this.app,result.title,result.value).open();}
            catch(e){this.display();notice(e);}
        }));
        el.createEl("p",{text:"独立测试库："+folder});
        field("局域网 WebDAV 地址",c.home,v=>c.home=v);
        field("外网 WebDAV 地址",c.away,v=>c.away=v);
        field("可信提交服务 HTTPS 地址",c.witness,v=>c.witness=v);
        field("WebDAV 用户名",c.username,v=>c.username=v);
        field("WebDAV 密码（留空沿用）","",v=>password=v,true);
        field("这台设备的名称",c.name,v=>c.name=v);
        button("保存连接设置",()=>p.configure(c,password));
        if(p.config.anchor)el.createEl("p",{text:"库指纹："+p.config.anchor});
        if(!p.config.anchor){
            field("建库授权（服务部署者提供）","",v=>bootstrap=v,true);
            button("在局域网创建测试库",async()=>{
                const seed=pq.freshSeed();
                // Save the recovery material before creating the remote vault.
                const out=new Output(this.app,"先离线保存恢复码，然后确认创建",seed);
                const previous=out.onOpen.bind(out);
                out.onOpen=()=>{previous();new Setting(out.contentEl).addButton(b=>b.setButtonText("我已保存，创建").onClick(async()=>{
                    try{await p.exclusive(()=>p.create(seed,bootstrap));out.close();this.display();}catch(e){notice(e);}
                }));};out.open();
            });
            field("从管理员 Mac 核对的库指纹","",v=>code=v);
            button("申请配对",async()=>({title:"请在管理员 Mac 输入此配对码",value:await p.request(code.trim())}));
        }
        if(p.config.request){
            el.createEl("p",{text:"本设备配对码（10 分钟有效）："+p.config.request});
        }
        if(p.config.anchor && !p.config.admin){
            button("重新申请配对",async()=>({title:"新配对码",value:await p.request(p.config.anchor)}));
        }
        if(p.config.integrity)el.createEl("p",{text:p.config.integrity});
        if(p.config.anchor){
            button("立即同步 / 检查配对",async()=>{const r=await p.sync();new Notice(r.route+" · 上传 "+r.sent+" · 下载 "+r.received);});
            if(p.config.admin){
                button("重新校验恢复数据",()=>p.verifyRecovery());
                field("新设备显示的配对码","",v=>request=v);
                button("批准已核对的配对码",()=>p.approve(request.trim()));
                for(const member of p.config.others||[])button("撤销设备 · "+member.name+" · "+member.id.slice(-8),async()=>{
                    const modal=new Modal(this.app);modal.setTitle("撤销 "+member.name+" 并轮换库密钥？");
                    new Setting(modal.contentEl).addButton(b=>b.setButtonText("确认撤销").onClick(async()=>{
                        try{await p.exclusive(()=>p.revoke(member.id));modal.close();this.display();}catch(e){notice(e);}
                    }));modal.open();
                });
            }
        }
        field("离线恢复码","",v=>recovery=v,true);
        button("用恢复码接管，撤销原设备",async()=>{
            const saved=p.pendingRecovery(),replacement=saved||pq.freshSeed();
            const kit=await p.replacementKit(recovery.trim(),replacement);
            const modal=new Output(this.app,"先离线保存新恢复码。确认后旧码、原设备均会失效。",kit);
            const open=modal.onOpen.bind(modal);
            modal.onOpen=()=>{open();
            new Setting(modal.contentEl).addButton(b=>b.setButtonText("确认恢复").onClick(async()=>{
                try{await p.exclusive(()=>p.restore(recovery.trim(),replacement));modal.close();this.display();}catch(e){notice(e);}
            }));};modal.open();
        });
    }
}
module.exports=class Preview extends Plugin{
    async onload(){
        const saved=await this.loadData();
        if(this.manifest.id!=="homebound-webdav-pqc-preview" || (saved && ("secretId" in saved || "id" in saved))){
            throw Error("此安装位置或配置属于正式版。请保留原插件，在独立位置安装 PQC 测试版。");
        }
        if(saved?.anchor && saved.format!==2)throw Error("请在独立 beta.2 本地库启用，旧测试库使用原版本。");
        this.config={format:2,home:"",away:"",witness:"",username:"",name:"我的设备",...saved};
        if(!this.config.local){this.config.local=core.randomId();await this.saveData(this.config);}
        this.addSettingTab(new Settings(this.app,this));
        this.addCommand({id:"seal-history",name:"管理员：封存当前历史并轮换密钥",checkCallback:checking=>{
            if(!this.config.admin)return false;
            if(!checking)this.exclusive(()=>this.sealHistory()).then(()=>new Notice("已封存历史并轮换密钥。")).catch(notice);
            return true;
        }});
        this.addCommand({id:"sync",name:"立即同步",callback:()=>this.exclusive(()=>this.sync()).then(r=>new Notice(r.route+" · 上传 "+r.sent+" · 下载 "+r.received)).catch(notice)});
    }
    async exclusive(fn){if(this.busy)throw Error("操作进行中。");this.busy=true;try{return await fn();}finally{this.busy=false;}}
    secret(k,v){
        const s=this.app.secretStorage,id="hbpqc-"+this.config.local+"-"+k;
        if(v!==undefined)s.setSecret(id,v);
        return s.getSecret(id);
    }
    async configure(c,password){
        const home=core.endpoint(c.home),away=c.away?core.endpoint(c.away):"";
        const witness=core.endpoint(c.witness);
        if(!witness.startsWith("https://") || (this.config.anchor&&this.config.witness!==witness))throw Error("可信提交服务需使用建库时核对的 HTTPS 地址。");
        Object.assign(this.config,{home,away,witness,name:c.name.trim(),username:c.username.trim()});
        if(password)this.secret("dav",password);await this.saveData(this.config);
    }
    async device(){
        if(!this.keys){let seed=this.secret("device");if(!seed){seed=pq.freshSeed();this.secret("device",seed);}this.keys=await pq.identity(seed,"device");}
        return this.keys;
    }
    base(url){return new Dav(core.endpoint(url),credentials(this.config.username,this.secret("dav")));}
    async route(){
        const c=this.config;
        for(const [i,url] of [c.home,c.away].entries()){
            const dav=this.base(url).child(folder).child(namespace);
            let timer;
            try{
                await Promise.race([dav.read("vault.json"),new Promise((_,reject)=>{
                    timer=setTimeout(()=>reject(Object.assign(Error("连接超时"),{offline:true})),i===0&&c.away?3000:16000);
                })]);return {dav,route:i?"VPS/VPN":"LAN"};
            }catch(e){if(i||!e.offline||!c.away)throw e;}finally{clearTimeout(timer);}
        }
    }
    async create(seed,bootstrap){
        const rec=await pq.identity(seed,"recovery"), dev=await this.device(), home=this.base(this.config.home), dir=home.child(folder);
        try{await home.mkdir(folder);}catch(e){if(e.status!==405)throw e;}
        const known=await dir.list();
        if(known.some(x=>x!==namespace))throw Error("新测试目录包含其他文件。");
        const dav=dir.child(namespace);
        if(!known.length)await dir.mkdir(namespace);
        for(const name of ["objects","requests"])try{await dav.mkdir(name);}catch(e){if(e.status!==405)throw e;}
        let live;
        try{live=await pq.state(this.ledger.bind(this),rec.id);}catch(e){if(e.status!==404)throw e;}
        if(live){
            if(live.policies.length!==1||pq.latest(live).p.admin!==dev.id)throw Error("服务已绑定到另一管理员。");
        }else await pq.genesis(this.ledger.bind(this),dev,this.config.name,rec,bootstrap);
        await dav.put("vault.json",core.jsonBytes({format:2,anchor:rec.id}).buffer);
        this.config.anchor=rec.id;await this.refresh();return rec.id;
    }
    async ledger(method,data,token){
        const nonce=core.randomId(), headers={"Cache-Control":"no-store"};
        if(token)headers.Authorization="Bearer "+token;
        const response=await requestUrl({url:this.config.witness+"/"+method,method:"POST",headers,
            contentType:"application/json",body:JSON.stringify({...data,transportNonce:nonce}),throw:false});
        if(response.status!==200){
            const msg=({403:"未获授权、已撤销或恢复码失效",404:"请求不存在",409:"授权已变化，请重新同步或配对"})[response.status]||"可信提交服务不可用";
            throw Object.assign(Error(msg+" ("+response.status+")"),{status:response.status});
        }
        return response.json;
    }
    async snapshot(anchor=this.config.anchor,withRevisions=true){return pq.state(this.ledger.bind(this),anchor,this.config.pin,withRevisions);}
    async context(anchor=this.config.anchor){
        const [s,r]=await Promise.all([this.snapshot(anchor),this.route()]);
        const marker=core.parseBytes(await r.dav.read("vault.json"));
        if(marker.format!==2||marker.anchor!==anchor)throw Error("WebDAV 指向另一测试库。");
        return {...r,s,device:await this.device()};
    }
    async refresh(snapshot){
        const s=snapshot||await this.snapshot(this.config.anchor,false),dev=await this.device(),{p,digest}=pq.latest(s);
        this.config.pin={n:p.n,digest};this.config.admin=p.admin===dev.id;
        this.config.others=Object.entries(p.members).filter(([id])=>id!==dev.id).map(([id,m])=>({id,name:m.name}));
        if(p.members[dev.id])delete this.config.request;
        await this.saveData(this.config);
    }
    async request(anchor){
        if(this.config.anchor&&this.config.anchor!==anchor)throw Error("库指纹不匹配。");
        const {dav,s,device}=await this.context(anchor);
        if(pq.latest(s).p.members[device.id])throw Error("这台设备已获授权，可以直接同步。");
        const code=await pq.requestPair(dav,s,device,this.config.name);
        Object.assign(this.config,{anchor,request:code});await this.refresh();return code;
    }
    async approve(code){
        const {dav,s,device}=await this.context();
        const target=await pq.readRequest(dav,s,code);
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
        this.secret("device",seed);this.keys=dev;this.config.anchor=anchor;
        this.config.integrity="管理员已接管，尚未完成数据校验。";
        await this.refresh();this.secret("pending-root","");this.secret("pending-device","");
        return this.verifyRecovery();
    }
    async verifyRecovery(){
        let report;
        try{
            const {s,dav,device}=await this.context();
            const store=await pq.storeFor(this.ledger.bind(this),dav,s,device);
            report=await pq.auditData(store);
            this.config.integrity=report.faults.length?"已接管，数据不完整："+report.faults.map(f=>f.path+" ["+f.id+"]").join("，"):"已校验 "+report.checked+" 条历史修订及对应正文。";
        }catch(e){this.config.integrity="已接管，数据校验失败："+e.message;report={faults:[{path:e.path,id:e.id,error:e.message}]};}
        await this.saveData(this.config);return report;
    }
    async sync(){
        const {dav,device,s,route}=await this.context(),last=pq.latest(s);
        if(!last.p.members[device.id]){
            await this.refresh(s);
            throw Error("此设备未获授权，或已被撤销。请在设置中重新申请配对。");
        }
        const store=await pq.storeFor(this.ledger.bind(this),dav,s,device);
        this.config.pin={n:last.p.n,digest:last.digest}; delete this.config.request;
        await this.saveData(this.config);
        const id="hbpqc-baseline-"+this.config.anchor;
        const r=await core.synchronize({store,local:new VaultFiles(this.app),baseline:new Map(this.app.loadLocalStorage(id)||[]),
            cache:new Map(),checkpoint:m=>this.app.saveLocalStorage(id,[...m]),active:()=>!this.closed});
        return {route,sent:r.sent,received:r.received,conflicts:r.conflicts};
    }
    onunload(){this.closed=true;}
};
