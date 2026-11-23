"use strict";

const limited = error => error?.status === 429 || error?.status === 503;
const concurrencyLevels = Object.freeze([20, 12, 8, 4, 1]);

// Setup also uses this window for replayable PUTs and commit markers. Drain all
// jobs before retrying a throttled request or moving on to the next phase.
class ReadWindow {
    constructor(limit = 4, onLower) {
        this.limit = limit;
        this.onLower = onLower;
    }

    async one(work) {
        let value;
        await this.each(1, async () => { value = await work(); });
        return value;
    }

    async each(count, read) {
        let next = 0;
        const retry = [];
        while (next < count || retry.length) {
            // Give retries priority, filling spare slots with untouched work.
            const jobs = retry.splice(0, this.limit);
            while (jobs.length < this.limit && next < count) jobs.push(next++);
            const results = await Promise.allSettled(jobs.map(async i => read(i)));
            let throttled = false;
            let fatal;
            for (const [i, result] of results.entries()) {
                if (result.status === "fulfilled") continue;
                if (this.limit > 1 && limited(result.reason)) {
                    retry.push(jobs[i]);
                    throttled = true;
                } else {
                    fatal ??= result;
                }
            }
            if (throttled) {
                // Several rejections in the same wave describe the same load level.
                this.limit = concurrencyLevels.find(level => level < this.limit);
                this.onLower?.(this.limit);
            }
            if (fatal) throw fatal.reason;
            if (throttled) await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
}

module.exports = {ReadWindow, limited, concurrencyLevels};
