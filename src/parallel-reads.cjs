"use strict";

const limited = error => error?.status === 429 || error?.status === 503;

// A sync uses one window for metadata, whole files and blocks. A window is
// drained before the next phase starts, including on cancellation or failure.
class ReadWindow {
    constructor(limit = 4) { this.limit = limit; }

    async each(count, read) {
        for (let start = 0; start < count;) {
            const length = Math.min(this.limit, count - start);
            const jobs = Array.from({length}, (_, i) => start + i);
            const results = await Promise.allSettled(jobs.map(read));
            const retry = [];
            for (const [i, result] of results.entries()) {
                if (result.status === "fulfilled") continue;
                if (this.limit === 1 || !limited(result.reason)) throw result.reason;
                retry.push(jobs[i]);
            }
            if (retry.length) {
                this.limit = 1;
                await new Promise(resolve => setTimeout(resolve, 500));
                for (const i of retry) await read(i);
            }
            start += length;
        }
    }
}

module.exports = {ReadWindow, limited};
