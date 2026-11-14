#target illustrator
// SPDX-License-Identifier: MIT
// Read-only ExtendScript boundary. Returned geometry/paths are local bridge data,
// never public WorkProof events. No document names, text content or layer names are read.
(function () {
    function encode(value) {
        if (value === null) return "null";
        if (typeof value === "boolean") return value ? "true" : "false";
        if (typeof value === "number") {
            if (!isFinite(value)) throw Error("NON_FINITE_VALUE");
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
        var file = doc.fullName;
        if (!file || !file.exists) throw Error('SAVE_LOCAL_DOCUMENT_FIRST');
        var path = file.fsName;
        var started = new Date().getTime();
        var total = doc.pageItems.length;
        if (total > 4096) throw Error('OBJECT_LIMIT');
        var rows = [], ids = {}, groups = 0, visible = 0, pathPoints = 0;
        function coordinates(point) {
            if (!point || point.length !== 2) throw Error('PATH_POINT_UNAVAILABLE');
            var x = Number(point[0]), y = Number(point[1]);
            if (!isFinite(x) || !isFinite(y) || Math.abs(x) > 1000000000 || Math.abs(y) > 1000000000)
                throw Error('INVALID_BOUNDS');
            return [x, y];
        }
        for (var i = 0; i < total; ++i) {
            if (new Date().getTime() - started > 100) throw Error('SNAPSHOT_BUDGET');
            var item = doc.pageItems[i];
            var id = String(item.uuid || '');
            if (!/^[A-Fa-f0-9{}-]{8,64}$/.test(id) || ids['id:' + id]) throw Error('STABLE_OBJECT_ID_UNAVAILABLE');
            ids['id:' + id] = true;
            var kind = String(item.typename);
            if (!/^[A-Za-z]{1,48}$/.test(kind)) throw Error('UNKNOWN_OBJECT_KIND');
            var bounds = item.geometricBounds;
            if (!bounds || bounds.length !== 4) throw Error('BOUNDS_UNAVAILABLE');
            var numbers = [];
            for (var j = 0; j < 4; ++j) {
                var n = Number(bounds[j]);
                if (!isFinite(n) || Math.abs(n) > 1000000000) throw Error('INVALID_BOUNDS');
                numbers.push(n);
            }
            var opacity = Number(item.opacity);
            if (!isFinite(opacity) || opacity < 0 || opacity > 100) throw Error('INVALID_OPACITY');
            var parent = item.parent;
            var parentId = parent && parent.typename === 'GroupItem' ? String(parent.uuid || '') : null;
            if (parentId !== null && !/^[A-Fa-f0-9{}-]{8,64}$/.test(parentId)) throw Error('PARENT_ID_UNAVAILABLE');
            var shown = !item.hidden;
            groups += kind === 'GroupItem' ? 1 : 0;
            visible += shown ? 1 : 0;
            var pathShape = null;
            if (kind === 'PathItem') {
                var points = item.pathPoints;
                if (!points || typeof points.length !== 'number') throw Error('PATH_POINT_UNAVAILABLE');
                var pointCount = points.length;
                pathPoints += pointCount;
                if (pathPoints > 8192) throw Error('PATH_POINT_LIMIT');
                var samples = [];
                for (var k = 0; k < pointCount; ++k) {
                    if (new Date().getTime() - started > 100) throw Error('SNAPSHOT_BUDGET');
                    var point = points[k];
                    samples.push([coordinates(point.anchor), coordinates(point.leftDirection),
                        coordinates(point.rightDirection)]);
                }
                pathShape = [!!item.closed, samples];
            }
            rows.push([id, parentId, i, kind, shown, opacity, numbers, pathShape]);
        }
        // Host calls are synchronous but the active document can still change through host reentrancy.
        if (app.activeDocument !== doc || doc.fullName.fsName !== path || doc.pageItems.length !== total)
            throw Error('DOCUMENT_CHANGED_DURING_SAMPLE');
        var result = {format:'workproof-illustrator-snapshot/1',path:path,saved:!!doc.saved,
            metrics:{objects:total,groups:groups,unhidden_objects:visible,path_points:pathPoints},objects:rows};
        return encode(result);
    } catch (failure) {
        // Allowlisted diagnostics only; never return host exception text or artwork content.
        var message = String(failure.message || '');
        var known = /^(NO_ACTIVE_DOCUMENT|SAVE_LOCAL_DOCUMENT_FIRST|OBJECT_LIMIT|SNAPSHOT_BUDGET|STABLE_OBJECT_ID_UNAVAILABLE|UNKNOWN_OBJECT_KIND|BOUNDS_UNAVAILABLE|INVALID_BOUNDS|INVALID_OPACITY|PARENT_ID_UNAVAILABLE|PATH_POINT_UNAVAILABLE|PATH_POINT_LIMIT|DOCUMENT_CHANGED_DURING_SAMPLE)$/;
        return encode({error:known.test(message) ? message : 'HOST_SNAPSHOT_UNAVAILABLE'});
    }
})();
