"use strict";

const {Modal, Setting} = require("obsidian");

class ConflictModal extends Modal {
    constructor(app, review, submit) {
        super(app);
        this.review = review;
        this.submit = submit;
    }
    onOpen() {
        this.setTitle("比较冲突副本");
        const {path, choices} = this.review;
        this.contentEl.createEl("p", {text:path});
        const group = this.contentEl.createDiv({cls:"homebound-conflict-copies"});
        const radios = [];
        let selected, confirm;
        for (const choice of choices) {
            const card = group.createDiv({cls:"homebound-conflict-copy"});
            const label = card.createEl("label");
            const radio = label.createEl("input", {attr:{type:"radio", name:"homebound-conflict-" + this.review.headIds[0]}});
            radios.push(radio);
            label.createSpan({text:" " + choice.label});
            radio.addEventListener("change", () => {
                selected = choice.source;
                confirm.setButtonText(choice.bytes === null ? "确认采用删除版本" : "采用选定正文").setDisabled(false);
            });
            if (choice.bytes === null) {
                card.createEl("p", {text:"此版本已删除文件。"});
            } else if (/\.(md|txt|canvas|json)$/i.test(path)) {
                const text = new TextDecoder().decode(choice.bytes);
                card.createEl("pre", {text:text || "（空文件）", cls:"homebound-conflict-preview"});
            } else {
                card.createEl("p", {text:"二进制附件 · " + choice.bytes.byteLength + " 字节"});
            }
        }
        const status = this.contentEl.createDiv({attr:{role:"status"}});
        new Setting(this.contentEl).addButton(b => b.setButtonText("取消").onClick(() => this.close()))
            .addButton(b => {
                confirm = b.setButtonText("采用选定正文").setCta().setDisabled(true).onClick(async () => {
                    confirm.setDisabled(true);
                    for (const radio of radios) radio.disabled = true;
                    status.setText("正在提交…");
                    try {
                        await this.submit(selected);
                        this.close();
                    } catch (e) {
                        // A new remote head or local edit requires a fresh comparison.
                        status.setText((e.message || String(e)) + " 请关闭窗口，重新同步后再比较。");
                    }
                });
            });
    }
    onClose() { this.contentEl.empty(); }
}

module.exports = {ConflictModal};
