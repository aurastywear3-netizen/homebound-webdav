"use strict";

const {sha} = require("./core.cjs");

// A candidate is a vault event. Count it only if its bytes differ from the last
// checkpoint, including a deletion of a previously published file.
class PendingUploads {
    constructor() {
        this.files = new Set();
        this.candidates = new Set();
        this.full = true;
        this.known = false;
    }
    refresh(local, readBaseline, active) {
        if (!this.work) {
            this.work = this.inspect(local, readBaseline, active).finally(() => { this.work = null; });
        }
        return this.work;
    }
    async inspect(local, readBaseline, active) {
        if (!this.full && !this.candidates.size) return;
        const baseline = readBaseline();
        const paths = this.full ? new Set([...local.paths(), ...baseline.keys()]) : this.candidates;
        const next = this.full ? new Set() : new Set(this.files);
        this.full = false;
        this.candidates = new Set();
        try {
            for (const path of paths) {
                if (!active()) return;
                if (!local.allowed(path)) continue;
                const bytes = await local.read(path);
                const hash = bytes === null ? null : await sha(bytes);
                if (hash !== (baseline.get(path)?.hash ?? null)) next.add(path);
                else next.delete(path);
            }
            this.files = next;
            this.known = true;
            this.failed = false;
        } catch (error) {
            this.full = true;
            this.known = false;
            this.failed = true;
            throw error;
        }
    }
}
module.exports = {PendingUploads};
