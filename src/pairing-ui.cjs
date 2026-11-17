"use strict";
const {Modal,Setting,Notice} = require("obsidian");
const invites = require("./pairing-invite.cjs");
const {deviceLimit} = require("./pqc.cjs");
const errorNotice = e => new Notice(e.message || String(e),10000);
const matchCode = code => code.slice(0,10).toUpperCase();

function scanButton(el, received) {
    const picker = el.createEl("input",{type:"file"});
    picker.accept = "image/*";
    picker.hidden = true;
    picker.onchange = async () => {
        const file = picker.files[0]; picker.value = "";
        if (!file) return;
        try { received(await invites.readPhoto(file)); } catch(e) { errorNotice(e); }
    };
    new Setting(el).addButton(b => b.setButtonText("扫码加入（拍照或选图）").onClick(()=>picker.click()));
}

function join(app, invite, submit, redraw) {
    const modal = new Modal(app);
    modal.setTitle("申请加入 PQC 库");
    modal.contentEl.createEl("p",{text:"本地库："+app.vault.getName()});
    modal.contentEl.createEl("p",{text:"WebDAV 地址："+invite.address});
    if (invite.ledger !== invite.address+"/homebound-pqc-ledger")
        modal.contentEl.createEl("p",{text:"提交服务："+invite.ledger});
    modal.contentEl.createEl("p",{text:"请核对管理员展示的地址和库指纹："+invite.anchor});
    const fields = {name:"",username:"",password:""};
    for (const [key,label] of [["name","本设备名称"],["username","本设备的 WebDAV 用户名"],["password","WebDAV 密码"]]) {
        new Setting(modal.contentEl).setName(label).addText(t=>{
            if(key==="password"){t.inputEl.type="password";t.inputEl.autocomplete="off";}
            t.onChange(value=>{fields[key]=value;});
        });
    }
    new Setting(modal.contentEl).addButton(b=>b.setCta().setButtonText("使用 PQC 并申请加入").onClick(async()=>{
        b.setDisabled(true);
        try{
            const code = await submit(fields);
            fields.password="";
            modal.contentEl.empty();modal.setTitle("等待管理员批准");
            modal.contentEl.createEl("p",{text:"请与管理员屏幕核对："+matchCode(code)});
            modal.contentEl.createEl("p",{text:"批准后在插件设置中点「刷新设备列表」。"});
            redraw();
        }catch(e){errorNotice(e);}finally{b.setDisabled(false);}
    }));
    modal.open();
}

class InviteModal extends Modal {
    constructor(app,p,invite,redraw){super(app);Object.assign(this,{p,invite,redraw});}
    onOpen(){
        this.active=true;
        this.setTitle("扫码加入此库");
        const canvas=this.contentEl.createEl("canvas",{cls:"homebound-invite-qr"});
        canvas.setAttribute("aria-label","Homebound 设备邀请二维码");
        invites.draw(canvas,this.invite.url);
        this.contentEl.createEl("p",{text:"新设备用相机扫码，或在插件里拍照或选择此码。邀请在 10 分钟后失效。"});
        this.contentEl.createEl("p",{text:this.invite.address});
        this.contentEl.createEl("p",{text:"库指纹："+this.invite.anchor});
        this.result=this.contentEl.createDiv();
        this.poll();
    }
    async poll(){
        if(!this.active || this.p.closed || this.loading)return;
        this.loading=true;
        try{
            const target=await this.p.invitedRequest(this.invite);
            if(!this.active || this.p.closed)return;
            this.result.empty();
            if(!target){
                this.result.createEl("p",{text:"等待新设备申请…"});
                this.timer=setTimeout(()=>this.poll(),3000);return;
            }
            this.result.createEl("p",{text:"设备："+target.name+"　核对码："+matchCode(target.code)});
            new Setting(this.result).addButton(b=>b.setCta().setButtonText("两端核对码一致，批准加入").onClick(async()=>{
                b.setDisabled(true);
                try{
                    await this.p.exclusive(()=>this.p.approve(target.code,this.invite));
                    this.close();this.redraw();new Notice("设备已授权。");
                }catch(e){errorNotice(e);b.setDisabled(false);}
            }));
        }catch(e){
            if(!this.active || this.p.closed)return;
            this.result.empty();this.result.createEl("p",{text:e.message || String(e)});
            if(Date.now()<this.invite.expires)new Setting(this.result).addButton(b=>b.setButtonText("重新检查申请").onClick(()=>this.poll()));
        }finally{this.loading=false;}
    }
    onClose(){this.active=false;clearTimeout(this.timer);this.contentEl.empty();}
}

function devices(el,p,app,redraw) {
    const group=el.createDiv();
    const show=()=>{
        group.empty();
        const list=p.config.roster;
        const row=new Setting(group).setName(list?.length ? "已授权设备（"+list.length+" / "+deviceLimit+"）" : "已授权设备");
        row.addButton(b=>b.setButtonText("刷新设备列表").onClick(async()=>{
            try{await p.exclusive(()=>p.refresh());redraw();}catch(e){errorNotice(e);}
        }));
        if(!list?.length){
            group.createEl("p",{text:p.config.request ? "此设备正在等待管理员批准。" : "刷新后可查看本设备的授权状态。"});
            return;
        }
        for(const m of list){
            const role=[m.admin?"管理员":"成员",m.self?"本机":"",m.id.slice(-8)].filter(Boolean).join(" · ");
            const device=new Setting(group).setName(m.name).setDesc(role);
            if(p.config.admin && !m.admin)device.addButton(b=>b.setButtonText("撤销").onClick(()=>{
                const modal=new Modal(app);modal.setTitle("撤销 "+m.name+" 并轮换库密钥？");
                modal.contentEl.createEl("p",{text:"设备指纹："+m.id});
                new Setting(modal.contentEl).addButton(c=>c.setWarning().setButtonText("确认撤销").onClick(async()=>{
                    try{await p.exclusive(()=>p.revoke(m.id));modal.close();redraw();}catch(e){errorNotice(e);}
                }));modal.open();
            }));
        }
        if(p.config.admin && list.length<deviceLimit)new Setting(group).addButton(b=>b.setButtonText("显示加入二维码").onClick(async()=>{
            try{
                const invite=await p.exclusive(()=>p.inviteDevice());
                new InviteModal(app,p,invite,redraw).open();
            }catch(e){errorNotice(e);}
        }));
    };
    show();
    // Update the signed roster when opening settings, without replacing text fields being edited.
    if(!p.busy && group.isConnected)void p.exclusive(()=>p.refresh()).then(()=>{
        if(!p.closed && group.isConnected)show();
    }).catch(e=>{if(group.isConnected)group.createEl("p",{text:"设备列表刷新失败："+e.message});});
}
module.exports={scanButton,join,devices};
