"use strict";

var childProcess = require("child_process");
var fs = require("fs");
var APP_ID = "com.github.int21asm.plainhome";
var LOG_FILE = "/tmp/plainhome-service.log";
var PID_FILE = "/tmp/plainhome-service.pid";
var POWER_PID_FILE = "/tmp/plainhome-power.pid";
var CONFIG_FILE = "/var/lib/webosbrew/plainhome.conf";
var CAPTURE_REQUEST_FILE = "/tmp/plainhome-shortcut-capture.request";
var CAPTURE_RESULT_FILE = "/tmp/plainhome-shortcut-capture.result";
var HOME_KEY_CODE = 773;
var INPUT_EVENT_SIZE = 16;
var INPUT_POLL_MS = 100;
var HOME_LAUNCH_DELAY_MS = 350;
/* Surface-manager config read by KeyFilters/systemUi.js: when true, the Home key no longer
   launches com.webos.app.home. Runtime-only (configd does not persist it), so a reboot or a
   configd restart brings LG Home back by itself. */
var DISABLE_HOME_CONFIG = "com.webos.surfacemanager.disableHome";
var HOME_LOCK = "/tmp/plainhome-home.lock";
var HOME_OWNER_FILE = "/tmp/plainhome-home-owner";
var homeButtonEnabled = process.argv.indexOf("--home") !== -1 || process.argv.indexOf("--watch") !== -1;
var shortcutCode = readShortcutCode();
var lgHomeSuppressed = false;
var watchedInputDevices = 0;

try {
  fs.writeFileSync(PID_FILE, String(process.pid));
} catch (error) {
  /* The PID file is only used to prevent duplicate watchers. */
}

function log(message) {
  try {
    fs.appendFileSync(LOG_FILE, "[" + new Date().toISOString() + "] " + message + "\n");
  } catch (error) {
    /* Logging must never prevent startup. */
  }
}

function readShortcutCode() {
  var match;
  try {
    match = /^shortcut=([0-9]+)$/m.exec(fs.readFileSync(CONFIG_FILE, "utf8"));
    return match && Number(match[1]) > 0 ? Number(match[1]) : 0;
  } catch (error) {
    return 0;
  }
}

function saveShortcutCode(code) {
  var text = "";
  var lines;
  try {
    text = fs.readFileSync(CONFIG_FILE, "utf8");
  } catch (error) {
    text = "boot=0\nhome=0\n";
  }
  lines = text.split(/\r?\n/).filter(function (line) {
    return line && line.indexOf("shortcut=") !== 0;
  });
  if (!lines.some(function (line) { return line.indexOf("boot=") === 0; })) lines.push("boot=0");
  if (!lines.some(function (line) { return line.indexOf("home=") === 0; })) lines.push("home=0");
  lines.push("shortcut=" + code);
  fs.writeFileSync(CONFIG_FILE, lines.join("\n") + "\n");
}

function setLgHomeDisabled(disabled) {
  var flag = disabled ? "true" : "false";
  var pid = String(process.pid);
  var output = "";
  /* Claim or release under one lock so a dying watcher cannot clear disableHome
     after a replacement watcher has taken the key. */
  var script =
    "owner=$(cat " + HOME_OWNER_FILE + " 2>/dev/null || true); " +
    "case \"$owner\" in ''|*[!0-9]*) owner=0 ;; esac; " +
    "if [ " + flag + " = false ] && [ \"$owner\" != " + pid + " ]; then printf skipped; exit 0; fi; " +
    "if [ " + flag + " = true ]; then printf '%s\\n' " + pid + " > " + HOME_OWNER_FILE + "; fi; " +
    "output=$(/usr/bin/luna-send -n 1 luna://com.webos.service.config/setConfigs " +
    "'{\"configs\":{\"" + DISABLE_HOME_CONFIG + "\":" + flag + "}}') || " +
    "{ if [ " + flag + " = true ] && [ \"$(cat " + HOME_OWNER_FILE + " 2>/dev/null)\" = " + pid + " ]; then rm -f " + HOME_OWNER_FILE + "; fi; exit 1; }; " +
    "printf '%s\\n' \"$output\" | grep -q '\"returnValue\":true' || " +
    "{ if [ " + flag + " = true ] && [ \"$(cat " + HOME_OWNER_FILE + " 2>/dev/null)\" = " + pid + " ]; then rm -f " + HOME_OWNER_FILE + "; fi; exit 1; }; " +
    "if [ " + flag + " = false ] && [ \"$(cat " + HOME_OWNER_FILE + " 2>/dev/null)\" = " + pid + " ]; then rm -f " + HOME_OWNER_FILE + "; fi; " +
    "printf '%s\\n' \"$output\"";
  try {
    output = String(childProcess.execFileSync(
      "/usr/bin/flock",
      ["-w", "8", HOME_LOCK, "sh", "-c", script],
      { timeout: 12000 }
    ));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      try {
        output = String(childProcess.execFileSync("sh", ["-c", script], { timeout: 8000 }));
      } catch (fallbackError) {
        log("setConfigs " + DISABLE_HOME_CONFIG + "=" + disabled + " failed: " + fallbackError.message);
        return false;
      }
    } else {
      log("setConfigs " + DISABLE_HOME_CONFIG + "=" + disabled + " failed: " + error.message);
      return false;
    }
  }
  log("setConfigs " + DISABLE_HOME_CONFIG + "=" + disabled + ": " + output.replace(/\s+/g, " ").slice(0, 200));
  return output.indexOf("skipped") !== -1 || /"returnValue"\s*:\s*true/.test(output);
}

function suppressLgHome() {
  lgHomeSuppressed = setLgHomeDisabled(true);
  if (!lgHomeSuppressed) return;
  /* Restore LG Home on the way out only while this process still owns the key. */
  process.on("exit", function () {
    if (lgHomeSuppressed) setLgHomeDisabled(false);
  });
  ["SIGTERM", "SIGINT", "SIGHUP"].forEach(function (signal) {
    process.on(signal, function () {
      log("received " + signal + ", exiting");
      process.exit(0);
    });
  });
}

function launch(reason, attempt, callback) {
  var payload = JSON.stringify({ id: APP_ID });
  childProcess.execFile(
    "/usr/bin/luna-send",
    [
      "-a", "com.webos.app.home",
      "-n", "1",
      "-f",
      "luna://com.webos.applicationManager/launch",
      payload
    ],
    { timeout: 6000 },
    function (error, stdout, stderr) {
      var response;
      var successful = false;
      if (!error) {
        try {
          response = JSON.parse(String(stdout || ""));
          successful = response.returnValue === true;
        } catch (parseError) {
          successful = false;
        }
      }
      log(
        reason + " launch #" + attempt +
        " rc=" + (error && typeof error.code !== "undefined" ? error.code : 0) +
        " success=" + successful +
        " output=" + String(stdout || stderr || "").replace(/\s+/g, " ").slice(0, 300)
      );
      callback(successful);
    }
  );
}

function launchWithRetry(reason, attempts, interval) {
  var attempt = 1;
  function run() {
    launch(reason, attempt, function (successful) {
      if (successful || attempt >= attempts) return;
      attempt += 1;
      setTimeout(run, interval);
    });
  }
  run();
}

var lastPowerState = "";
var powerMonitorRestart = null;

function handlePowerMessage(raw) {
  var message;
  var state;
  try {
    message = JSON.parse(raw);
  } catch (error) {
    return;
  }
  state = String(message.state || "");
  if (!state) return;
  if (state !== lastPowerState) log("power state: " + (lastPowerState || "unknown") + " -> " + state);
  if (state === "Active" && lastPowerState === "Suspend") {
    setTimeout(function () {
      launchWithRetry("power-active", 4, 1500);
    }, 1200);
  }
  lastPowerState = state;
}

function startPowerMonitor() {
  var buffer = "";
  var monitor = childProcess.spawn(
    "/usr/bin/luna-send",
    [
      "-a", "com.webos.app.home",
      "-i",
      "luna://com.webos.service.tvpower/power/getPowerState",
      JSON.stringify({ subscribe: true })
    ]
  );
  try {
    fs.writeFileSync(POWER_PID_FILE, String(monitor.pid));
  } catch (error) {
    /* The PID file is only used to stop an old subscription on restart. */
  }
  log("power monitor started, pid=" + monitor.pid);
  monitor.stdout.on("data", function (chunk) {
    var lines;
    buffer += String(chunk);
    lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    lines.forEach(handlePowerMessage);
  });
  monitor.stderr.on("data", function (chunk) {
    log("power monitor stderr: " + String(chunk).replace(/\s+/g, " ").slice(0, 300));
  });
  monitor.on("error", function (error) {
    log("power monitor error: " + error.message);
  });
  monitor.on("exit", function (code) {
    if (buffer) handlePowerMessage(buffer);
    log("power monitor exited rc=" + code + "; restarting");
    if (powerMonitorRestart) clearTimeout(powerMonitorRestart);
    powerMonitorRestart = setTimeout(startPowerMonitor, 2000);
  });
}

function watchRemoteButtons() {
  var names;
  var descriptors = [];
  var buffer = Buffer.alloc(INPUT_EVENT_SIZE * 64);
  var lastHomePress = 0;
  var lastShortcutPress = 0;
  var ignoreShortcutUntil = 0;
  try {
    names = fs.readdirSync("/dev/input").filter(function (name) {
      return name.indexOf("event") === 0;
    });
  } catch (error) {
    log("cannot read /dev/input: " + error.message);
    return 0;
  }
  names.forEach(function (name) {
    try {
      descriptors.push(fs.openSync(
        "/dev/input/" + name,
        fs.constants.O_RDONLY | fs.constants.O_NONBLOCK
      ));
    } catch (error) {
      /* Ignore unavailable or phantom input nodes. */
    }
  });
  log("Remote button watcher is reading " + descriptors.length + " input devices");
  if (!descriptors.length) return 0;
  setInterval(function () {
    descriptors.forEach(function (descriptor) {
      var bytes;
      var offset;
      try {
        bytes = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      } catch (error) {
        return;
      }
      for (offset = 0; offset + INPUT_EVENT_SIZE <= bytes; offset += INPUT_EVENT_SIZE) {
        var eventType = buffer.readUInt16LE(offset + 8);
        var keyCode = buffer.readUInt16LE(offset + 10);
        var keyValue = buffer.readInt32LE(offset + 12);
        if (eventType !== 1 || keyValue !== 1) continue;

        if (fs.existsSync(CAPTURE_REQUEST_FILE)) {
          try {
            saveShortcutCode(keyCode);
            shortcutCode = keyCode;
            fs.unlinkSync(CAPTURE_REQUEST_FILE);
            fs.writeFileSync(CAPTURE_RESULT_FILE, String(keyCode));
            ignoreShortcutUntil = Date.now() + 1500;
            log("Remote shortcut captured: code=" + keyCode);
          } catch (error) {
            try {
              fs.writeFileSync(CAPTURE_RESULT_FILE, "error:" + error.message);
            } catch (writeError) {
              /* The log below is the final fallback. */
            }
            log("Remote shortcut capture failed: " + error.message);
          }
          continue;
        }

        if (homeButtonEnabled && keyCode === HOME_KEY_CODE && Date.now() - lastHomePress > 1200) {
          lastHomePress = Date.now();
          log("Home button pressed");
          /* With LG Home suppressed there is nothing to wait for. */
          setTimeout(function () {
            launchWithRetry("home-key", 3, 500);
          }, lgHomeSuppressed ? 0 : HOME_LAUNCH_DELAY_MS);
        } else if (
          shortcutCode > 0 &&
          keyCode === shortcutCode &&
          Date.now() >= ignoreShortcutUntil &&
          Date.now() - lastShortcutPress > 1200
        ) {
          lastShortcutPress = Date.now();
          log("Remote shortcut pressed: code=" + keyCode);
          setTimeout(function () {
            launchWithRetry("remote-shortcut", 3, 500);
          }, 100);
        }
      }
    });
  }, INPUT_POLL_MS);
  return descriptors.length;
}

log("startup/wake watcher started, pid=" + process.pid);
if (process.argv.indexOf("--boot") !== -1) {
  startPowerMonitor();
  launchWithRetry("boot", 8, 2000);
}
if (
  homeButtonEnabled ||
  process.argv.indexOf("--shortcut") !== -1 ||
  process.argv.indexOf("--capture") !== -1
) {
  watchedInputDevices = watchRemoteButtons();
}
/* Only take the Home key away from LG when this watcher can actually see it. */
if (homeButtonEnabled && watchedInputDevices > 0) {
  suppressLgHome();
}
