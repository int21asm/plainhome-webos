/* Runs only through the rooted Homebrew helper. Keep ES5 syntax for webOS Node compatibility. */
"use strict";

var fs = require("fs");
var path = require("path");

var APP_ROOTS = [
  "/usr/palm/applications",
  "/media/cryptofs/apps/usr/palm/applications",
  "/media/developer/apps/usr/palm/applications"
];
var MAX_ICON_BYTES = 2 * 1024 * 1024;
var ICON_LIMIT = 512;
var ALLOWED_EXTENSIONS = { ".png": true, ".jpg": true, ".jpeg": true, ".webp": true, ".svg": true };

function contains(root, candidate) {
  return candidate === root || candidate.indexOf(root + path.sep) === 0;
}

function allowedRealPath(candidate) {
  var resolved = path.resolve(candidate);
  var index;
  var root;
  var realRoot;
  var realCandidate;

  try {
    realCandidate = fs.realpathSync(resolved);
  } catch (error) {
    return null;
  }

  for (index = 0; index < APP_ROOTS.length; index += 1) {
    root = path.resolve(APP_ROOTS[index]);
    if (!contains(root, resolved)) continue;
    try {
      realRoot = fs.realpathSync(root);
      if (contains(realRoot, realCandidate)) return realCandidate;
    } catch (error) {
      /* This root is absent on the current TV. */
    }
  }
  return null;
}

function usableIcon(candidate) {
  var canonical = allowedRealPath(candidate);
  var extension;
  var stat;
  if (!canonical) return null;
  extension = path.extname(canonical).toLowerCase();
  if (!ALLOWED_EXTENSIONS[extension]) return null;
  try {
    stat = fs.statSync(canonical);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_ICON_BYTES) return null;
  } catch (error) {
    return null;
  }
  return { path: canonical, extension: extension };
}

function resolveCandidate(candidate, folderPath) {
  if (typeof candidate !== "string" || !candidate) return null;
  if (/^(data|blob|https?|file):/i.test(candidate)) return null;
  if (candidate.charAt(0) === path.sep) return usableIcon(candidate);
  if (typeof folderPath !== "string" || !folderPath) return null;
  /* LG uses a leading $ for app-local system assets (for example $premium.png). */
  if (candidate.charAt(0) === "$") candidate = candidate.slice(1);
  return usableIcon(path.resolve(folderPath, candidate));
}

function readAppInfoCandidates(id) {
  var index;
  var directory;
  var appInfo;
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return null;

  for (index = APP_ROOTS.length - 1; index >= 0; index -= 1) {
    directory = path.join(APP_ROOTS[index], id);
    try {
      appInfo = JSON.parse(fs.readFileSync(path.join(directory, "appinfo.json"), "utf8"));
      return {
        folderPath: directory,
        paths: [appInfo.extraLargeIcon, appInfo.largeIcon, appInfo.mediumLargeIcon, appInfo.icon]
      };
    } catch (error) {
      /* Try the next application root. */
    }
  }
  return null;
}

function findIcon(request) {
  var candidates = request.paths instanceof Array ? request.paths : [];
  var index;
  var found;
  var fallback;

  for (index = 0; index < candidates.length; index += 1) {
    found = resolveCandidate(candidates[index], request.folderPath);
    if (found) return found;
  }

  fallback = readAppInfoCandidates(String(request.id || ""));
  if (!fallback) return null;
  for (index = 0; index < fallback.paths.length; index += 1) {
    found = resolveCandidate(fallback.paths[index], fallback.folderPath);
    if (found) return found;
  }
  return null;
}

function ensureDirectory(directory) {
  try {
    fs.mkdirSync(directory);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
}

function clearGeneratedIcons(directory) {
  var names;
  var index;
  try {
    names = fs.readdirSync(directory);
  } catch (error) {
    return;
  }
  for (index = 0; index < names.length; index += 1) {
    if (!/^\d+-[A-Za-z0-9._-]+\.(png|jpe?g|webp|svg)$/i.test(names[index])) continue;
    try {
      fs.unlinkSync(path.join(directory, names[index]));
    } catch (error) {
      /* A stale icon is harmless if webOS still has it open. */
    }
  }
}

function main() {
  var requests;
  var output = {};
  var outputDirectory = path.join(__dirname, "icons");
  var index;
  var request;
  var icon;
  var filename;
  var data;

  try {
    var input = process.argv[2] || "";
    var decoded = Buffer.from ? Buffer.from(input, "base64") : new Buffer(input, "base64");
    requests = JSON.parse(decoded.toString("utf8"));
  } catch (error) {
    process.stderr.write("Invalid icon request\n");
    process.exit(2);
  }

  if (!(requests instanceof Array)) requests = [];
  requests = requests.slice(0, ICON_LIMIT);
  ensureDirectory(outputDirectory);
  clearGeneratedIcons(outputDirectory);

  for (index = 0; index < requests.length; index += 1) {
    request = requests[index] || {};
    if (typeof request.key !== "string" || !request.key) continue;
    icon = findIcon(request);
    if (!icon) continue;

    filename = String(index) + "-" + String(request.id || "app").replace(/[^A-Za-z0-9._-]/g, "_") + icon.extension;
    try {
      data = fs.readFileSync(icon.path);
      if (!data.length || data.length > MAX_ICON_BYTES) continue;
      fs.writeFileSync(path.join(outputDirectory, filename), data, { mode: 420 });
      output[request.key] = "icons/" + filename;
    } catch (error) {
      /* The UI will retain its initial fallback. */
    }
  }

  process.stdout.write(JSON.stringify({ icons: output }));
}

main();
