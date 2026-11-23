const test = require("node:test");
const assert = require("node:assert/strict");
const {ReadWindow} = require("../src/parallel-reads.cjs");

test("429 and 503 lower the window once per rejected batch and keep available slots busy", async () => {
    const lowered = [], peaks = new Map(), completed = new Set(), attempts = new Map();
    const window = new ReadWindow(20, limit => lowered.push(limit));
    let active = 0;
    await window.each(60, async i => {
        const limit = window.limit;
        peaks.set(limit, Math.max(peaks.get(limit) ?? 0, ++active));
        attempts.set(i, (attempts.get(i) ?? 0) + 1);
        await new Promise(setImmediate);
        active--;
        // A full rejected wave leaves more retries than fit in the next window.
        if (limit === 20 || (i === 0 && limit > 1)) {
            const status = limit === 20 || limit === 8 ? 429 : 503;
            throw Object.assign(Error("server busy"), {status});
        }
        assert(!completed.has(i));
        completed.add(i);
    });
    assert.deepEqual(lowered, [12, 8, 4, 1]);
    assert.deepEqual([...peaks], [[20,20], [12,12], [8,8], [4,4], [1,1]]);
    assert.equal(completed.size, 60);
    for (const [i, n] of attempts) assert.equal(n, i === 0 ? 5 : i < 20 ? 2 : 1);
});

test("persistent overload at one slot stops, and a permanent error drains its batch without retry", async () => {
    const window = new ReadWindow(4);
    const error = Object.assign(Error("busy"), {status:503});
    const attempts = [];
    await assert.rejects(window.one(() => { attempts.push(window.limit); throw error; }), e => e === error);
    assert.deepEqual(attempts, [4, 1]);

    const fresh = new ReadWindow(20);
    let calls = 0, finished = 0;
    await assert.rejects(fresh.each(25, async i => {
        calls++;
        if (!i) throw Object.assign(Error("forbidden"), {status:403});
        await new Promise(setImmediate);
        finished++;
    }), /forbidden/);
    assert.equal(calls, 20);
    assert.equal(finished, 19);
    assert.equal(fresh.limit, 20);

    await assert.rejects(fresh.each(2, async i => {
        throw Object.assign(Error(i ? "forbidden" : "busy"), {status:i ? 403 : 429});
    }), /forbidden/);
    assert.equal(fresh.limit, 12);
});
