"use strict";
const {Plugin,PluginSettingTab,Setting,Modal,Notice}=require("obsidian");
const core=require("./core.cjs");
const pq=require("./pqc.cjs");
const {Dav,VaultFiles,credentials}=require("./adapter.cjs");
const folder="Homebound-PQC-Lab";
const namespace="pqc-preview-1";
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
        const c={...p.config};let password="",code="",request="",recovery="";
        const field=(label,value,change,secret=false)=>new Setting(el).setName(label).addText(t=>{
            t.setValue(value).onChange(change);if(secret)t.inputEl.type="password";
        });
        const button=(label,fn)=>new Setting(el).addButton(b=>b.setButtonText(label).onClick(async()=>{
            try{const result=await p.exclusive(fn);this.display();if(result?.title)new Output(this.app,result.title,result.value).open();}
            catch(e){notice(e);}
        }));
        el.createEl("p",{text:"独立测试库："+folder});
        field("局域网 WebDAV 地址",c.home,v=>c.home=v);
        field("外网 WebDAV 地址",c.away,v=>c.away=v);
        field("WebDAV 用户名",c.username,v=>c.username=v);
        field("WebDAV 密码（留空沿用）","",v=>password=v,true);
        field("这台设备的名称",c.name,v=>c.name=v);
        button("保存连接设置",()=>p.configure(c,password));
        if(p.config.anchor)el.createEl("p",{text:"库指纹："+p.config.anchor});
        if(!p.config.anchor){
            button("在局域网创建测试库",async()=>{
                const seed=pq.freshSeed();
                // Save the recovery material before creating the remote vault.
                const out=new Output(this.app,"先离线保存恢复码，然后确认创建",seed);
                const previous=out.onOpen.bind(out);
                out.onOpen=()=>{previous();new Setting(out.contentEl).addButton(b=>b.setButtonText("我已保存，创建").onClick(async()=>{
                    try{await p.exclusive(()=>p.create(seed));out.close();this.display();}catch(e){notice(e);}
                }));};out.open();
            });
            field("从管理员 Mac 核对的库指纹","",v=>code=v);
            button("申请配对",async()=>({title:"请在管理员 Mac 输入此配对码",value:await p.request(code.trim())}));
        }
        if(p.config.request)el.createEl("p",{text:"本设备配对码："+p.config.request});
        if(p.config.anchor){
            button("立即同步 / 检查配对",async()=>{const r=await p.sync();new Notice(r.route+" · 上传 "+r.sent+" · 下载 "+r.received);});
            if(p.config.admin){
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
            const modal=new Modal(this.app);modal.setTitle("接管测试库并撤销所有原设备？");
            new Setting(modal.contentEl).addButton(b=>b.setButtonText("确认恢复").onClick(async()=>{
                try{await p.exclusive(()=>p.restore(recovery.trim()));modal.close();this.display();}catch(e){notice(e);}
            }));modal.open();
        });
    }
}
module.exports=class Preview extends Plugin{
    async onload(){
        this.config={home:"",away:"",username:"",name:"我的设备",...await this.loadData()};
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
        Object.assign(this.config,{home,away,name:c.name.trim(),username:c.username.trim()});
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
                await Promise.race([dav.child("e-00000000").read("policy.json"),new Promise((_,reject)=>{
                    timer=setTimeout(()=>reject(Object.assign(Error("连接超时"),{offline:true})),i===0&&c.away?3000:16000);
                })]);return {dav,route:i?"VPS/VPN":"LAN"};
            }catch(e){if(i||!e.offline||!c.away)throw e;}finally{clearTimeout(timer);}
        }
    }
    async create(seed){
        const rec=await pq.identity(seed,"recovery"), dev=await this.device(), home=this.base(this.config.home), dir=home.child(folder);
        try{await home.mkdir(folder);}catch(e){if(e.status!==405)throw e;}
        const stage="stage-"+core.randomId();
        if((await dir.list()).some(x=>!/^stage-[a-f0-9]{32}$/.test(x)))throw Error("专用目录已被使用。请选择配对或恢复。");
        await dir.mkdir(stage);const tmp=dir.child(stage);await tmp.mkdir("requests");
        await pq.genesis(tmp,dev,this.config.name,rec);
        await dir.call("MOVE",stage,[201],{headers:{Destination:dir.child(namespace).root,Overwrite:"F"}});
        this.config.anchor=rec.id;await this.refresh();return rec.id;
    }
    async context(anchor=this.config.anchor){
        const r=await this.route();
        const policies=await pq.chain(r.dav,anchor,this.config.pin);
        return {...r,policies,device:await this.device()};
    }
    async refresh(){
        const {policies,device}=await this.context(),{p,digest}=policies.at(-1);
        this.config.pin={n:p.n,digest};this.config.admin=p.admin===device.id;
        this.config.others=Object.entries(p.members).filter(([id])=>id!==device.id).map(([id,m])=>({id,name:m.name}));
        if(p.members[device.id])delete this.config.request;
        await this.saveData(this.config);
    }
    async request(anchor){
        if(this.config.anchor && this.config.anchor!==anchor)throw Error("库指纹不一致。");
        const {dav,device}=await this.context(anchor);
        const code=await pq.requestPair(dav,anchor,device,this.config.name);
        Object.assign(this.config,{anchor,request:code});await this.refresh();return code;
    }
    async approve(code){
        const {dav,device,policies}=await this.context();
        const target=await pq.readRequest(dav,this.config.anchor,code);
        await pq.nextPolicy(dav,policies,device,"approve",target);await this.refresh();return target.id;
    }
    async sealHistory(){
        const {dav,device,policies}=await this.context();
        await pq.nextPolicy(dav,policies,device,"seal-history");await this.refresh();
    }
    async revoke(id){
        const {dav,device,policies}=await this.context();await pq.nextPolicy(dav,policies,device,"revoke",id);await this.refresh();
    }
    async restore(seed){
        const rec=await pq.identity(seed,"recovery");
        if(this.config.anchor && rec.id!==this.config.anchor)throw Error("恢复码与本库不符。");
        const {dav,device,policies}=await this.context(rec.id);
        await pq.nextPolicy(dav,policies,rec,"restore",{id:device.id,pub:pq.publicDevice(device,this.config.name)});
        this.config.anchor=rec.id;await this.refresh();
    }
    async sync(){
        const {dav,device,policies,route}=await this.context(),last=policies.at(-1);
        const store=await pq.storeFor(dav,policies,device);
        this.config.pin={n:last.p.n,digest:last.digest}; delete this.config.request;
        await this.saveData(this.config);
        const id="hbpqc-baseline-"+this.config.anchor;
        const r=await core.synchronize({store,local:new VaultFiles(this.app),baseline:new Map(this.app.loadLocalStorage(id)||[]),
            cache:new Map(),checkpoint:m=>this.app.saveLocalStorage(id,[...m]),active:()=>!this.closed});
        await pq.assertLatest(dav,last.p.n);return {route,sent:r.sent,received:r.received,conflicts:r.conflicts};
    }
    onunload(){this.closed=true;}
};
