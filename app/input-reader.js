/* Read-only EIM input discovery, executed through the rooted Homebrew helper. */
"use strict";

var fs = require("fs");

function cleanText(value, fallback) {
  var text = typeof value === "string" ? value.replace(/^\s+|\s+$/g, "") : "";
  return text || fallback;
}

function main() {
  var database;
  var items;
  var inputs = [];

  try {
    database = JSON.parse(fs.readFileSync("/var/lib/eim/eim_device_db.json", "utf8"));
    items = database && database.item instanceof Array ? database.item : [];
  } catch (error) {
    process.stdout.write(JSON.stringify({ inputs: [] }));
    return;
  }

  items.forEach(function (item) {
    var appId = String(item && item.szAppId || "");
    var match = /^com\.webos\.app\.hdmi([1-4])$/.exec(appId);
    /* bConnected can stay true for a configured port; bPlugIn reflects a live device. */
    if (!match || item.bPlugIn !== true) return;
    inputs.push({
      id: appId,
      port: Number(match[1]),
      title: cleanText(item.szUrcuLabel, cleanText(item.szDeviceName, "HDMI " + match[1]))
    });
  });

  inputs.sort(function (left, right) {
    return left.port - right.port;
  });
  process.stdout.write(JSON.stringify({ inputs: inputs }));
}

main();
