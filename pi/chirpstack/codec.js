function decodeUplink(input) {
    var str = String.fromCharCode.apply(null, input.bytes);

    // fPort 1: Registration (pipe-delimited)
    if (input.fPort === 1) {
        var reg = { fields: [] };
        str.split("|").forEach(function(segment) {
            var idx = segment.indexOf("=");
            if (idx > 0) {
                var key = segment.substring(0, idx);
                var val = segment.substring(idx + 1);

                if (key === "fields") {
                    val.split(",").forEach(function(f) {
                        var parts = f.split(":");
                        var field = { k: parts[0], n: parts[1] || parts[0], c: "cont", t: "num" };
                        if (parts[2]) field.u = parts[2];
                        if (parts[3]) field.min = parseFloat(parts[3]);
                        if (parts[4]) field.max = parseFloat(parts[4]);
                        reg.fields.push(field);
                    });
                } else if (key === "states") {
                    val.split(",").forEach(function(s) {
                        var parts = s.split(":");
                        var field = { k: parts[0], n: parts[1] || parts[0], c: "state", t: "enum" };
                        if (parts[2]) field.v = parts[2].split(";");
                        reg.fields.push(field);
                    });
                } else if (key === "cmds") {
                    reg.cmds = val.split(",").map(function(c) {
                        var parts = c.split(":");
                        return { k: parts[0], port: parseInt(parts[1]) };
                    });
                } else {
                    reg[key] = val;
                }
            }
        });
        return { data: reg };
    }

    // fPort 2+: Telemetry (comma-separated key:value)
    var data = {};
    str.split(",").forEach(function(p) {
        var kv = p.split(":");
        if (kv.length === 2) data[kv[0]] = parseFloat(kv[1]) || kv[1];
    });
    return { data: data };
}
