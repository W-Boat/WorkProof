#target indesign
// SPDX-License-Identifier: MIT
// Local read-only bridge. Story contents are hashed inside the native process.
(function () {
    function encode(value) {
        if (value === null) return "null";
        if (typeof value === "boolean") return value ? "true" : "false";
        if (typeof value === "number") {
            if (!isFinite(value)) throw Error("INVALID_NUMBER");
            return String(value);
        }
        if (typeof value === "string") return '"' + value.replace(/[\\"\x00-\x1f]/g, function (c) {
            if (c === '"' || c === '\\') return '\\' + c;
            return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
        }) + '"';
        var parts = [], i, key;
        if (value instanceof Array) {
            for (i = 0; i < value.length; ++i) parts.push(encode(value[i]));
            return '[' + parts.join(',') + ']';
        }
        for (key in value) if (value.hasOwnProperty(key)) parts.push(encode(key) + ':' + encode(value[key]));
        return '{' + parts.join(',') + '}';
    }
    try {
        if (!app.documents.length) throw Error('NO_ACTIVE_DOCUMENT');
        var doc = app.activeDocument;
        if (!doc.saved || doc.isCloudDocument) throw Error('SAVE_LOCAL_DOCUMENT_FIRST');
        var file = doc.fullName;
        if (!file || !file.exists) throw Error('SAVE_LOCAL_DOCUMENT_FIRST');
        var path = file.fsName, modified = !!doc.modified;
        var started = new Date().getTime();
        function budget() {
            if (new Date().getTime() - started > 150) throw Error('SNAPSHOT_BUDGET');
        }
        function id(object) {
            var value = Number(object.id);
            if (!isFinite(value) || value < 0 || value % 1) throw Error('INVALID_OBJECT_ID');
            return value;
        }
        var pageCount = doc.pages.length, storyCount = doc.stories.length;
        var items = doc.allPageItems;
        if (pageCount > 1024 || storyCount > 4096 || items.length > 4096) throw Error('OBJECT_LIMIT');
        var stories = [], characters = 0, seen = {};
        for (var i = 0; i < storyCount; ++i) {
            budget();
            var story = doc.stories[i], count = Number(story.characters.length);
            if (!isFinite(count) || count < 0 || characters + count > 1000000) throw Error('TEXT_LIMIT');
            var content = story.contents;
            if (typeof content !== 'string') throw Error('TEXT_UNAVAILABLE');
            if (content.length > 2000000) throw Error('TEXT_LIMIT');
            characters += count;
            stories.push([id(story), content]);
        }
        var layout = [];
        for (var j = 0; j < items.length; ++j) {
            budget();
            var item = items[j], uid = id(item), bounds = item.geometricBounds;
            if (seen['id:' + uid]) throw Error('DUPLICATE_OBJECT_ID');
            seen['id:' + uid] = true;
            if (!bounds || bounds.length !== 4) throw Error('BOUNDS_UNAVAILABLE');
            var coordinates = [];
            for (var k = 0; k < 4; ++k) {
                var n = Number(bounds[k]);
                if (!isFinite(n) || Math.abs(n) > 1000000000) throw Error('INVALID_BOUNDS');
                coordinates.push(n);
            }
            var angle = Number(item.rotationAngle);
            if (!isFinite(angle)) throw Error('INVALID_ROTATION');
            layout.push([uid, item.parentPage ? id(item.parentPage) : null, coordinates, angle]);
        }
        budget();
        if (app.activeDocument !== doc || doc.fullName.fsName !== path || !!doc.modified !== modified ||
            doc.stories.length !== storyCount || doc.allPageItems.length !== items.length)
            throw Error('DOCUMENT_CHANGED_DURING_SAMPLE');
        return encode({format:'workproof-indesign-snapshot/1',path:path,saved:!modified,
            metrics:{pages:pageCount,stories:storyCount,objects:items.length,characters:characters},
            stories:stories,layout:layout});
    } catch (failure) {
        var message = String(failure.message || failure);
        return encode({error:/^[A-Z_]+$/.test(message) ? message : 'HOST_API_UNAVAILABLE'});
    }
}());
