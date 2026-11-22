"use strict";

// A hint can start a sync, but only the authenticated revision history can complete it.
class VersionWatch {
    async read(dav) {
        if (this.mode !== "file") {
            const marker = await dav.collectionMarker();
            if (marker) {
                this.mode = "collection";
                // Collection timestamps may only distinguish whole seconds. Confirm the
                // commit set once after that window, even if the timestamp stayed equal.
                if (marker.tag !== this.observed) {
                    this.observed = marker.tag;
                    this.observedAt = Date.now();
                }
                return {tag:marker.tag, provisional:marker.coarse && Date.now()-this.observedAt < 2000};
            }
            this.mode = "file";
        }
        const response = await dav.call("GET","version",[200,404],{headers:{"Cache-Control":"no-cache"}});
        if (response.status === 404) return {tag:"file:missing"};
        if (!/^[a-f0-9]{32}$/.test(response.text)) throw Error("Invalid WebDAV version marker.");
        return {tag:"file:"+response.text};
    }
    changed(sample) {
        return sample.tag !== this.accepted?.tag || (this.accepted.provisional && !sample.provisional);
    }
    async trackWrites(store, action) {
        const previous = store.lastPublished;
        try { return await action(); }
        finally {
            if (store.lastPublished && store.lastPublished !== previous && this.mode !== "collection") {
                // Old clients ignore this file outside commits/. A lost hint must not
                // invalidate an already durable commit; the periodic full check repairs it.
                try { await store.dav.put("version",new TextEncoder().encode(store.lastPublished).buffer); }
                catch { /* The revision itself was published by MKCOL. */ }
            }
        }
    }
}
module.exports = {VersionWatch};
