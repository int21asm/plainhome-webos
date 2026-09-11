(function () {
  "use strict";

  var APP_ID = "com.github.int21asm.plainhome";
  var COLUMNS = 6;
  var ORDER_KEY = "plainHomeOrderV1";
  var TIME_FORMAT_KEY = "plainHomeTimeFormatV1";
  var LONG_PRESS_MS = 700;
  var appsElement = document.getElementById("apps");
  var statusElement = document.getElementById("status");
  var noticeElement = document.getElementById("notice");
  var confirmElement = document.getElementById("confirm");
  var confirmMessageElement = document.getElementById("confirm-message");
  var clockElement = document.getElementById("clock");
  var topActionsElement = document.getElementById("top-actions");
  var settingsElement = document.getElementById("settings");
  var timeFormatButton = document.getElementById("time-format");
  var headerButtons = Array.prototype.slice.call(document.querySelectorAll("#top-actions button"));
  var launchPoints = [];
  var buttons = [];
  var selectedIndex = 0;
  var selectedArea = "apps";
  var selectedHeaderIndex = 0;
  var activeBridges = [];
  var permissionBootstrapAttempted = false;
  var moveMode = false;
  var moveSnapshot = null;
  var enterTimer = null;
  var suppressEnterUp = false;
  var pendingRemoval = null;
  var refreshSelectionKey = "";
  var refreshSelectionIndex = 0;
  var settingsOpen = false;
  var timeFormat = readTimeFormat();

  function showStatus(message) {
    statusElement.textContent = message;
    statusElement.hidden = false;
  }

  function hideStatus() {
    statusElement.hidden = true;
  }

  function showNotice(message) {
    noticeElement.textContent = message;
    noticeElement.hidden = false;
  }

  function hideNotice() {
    noticeElement.hidden = true;
  }

  function readTimeFormat() {
    try {
      return window.localStorage.getItem(TIME_FORMAT_KEY) === "12" ? "12" : "24";
    } catch (error) {
      return "24";
    }
  }

  function saveTimeFormat() {
    try {
      window.localStorage.setItem(TIME_FORMAT_KEY, timeFormat);
    } catch (error) {
      showNotice("The time format changed, but webOS could not save it.");
    }
  }

  function updateTimeFormatButton() {
    timeFormatButton.textContent = "Time format: " + (timeFormat === "12" ? "AM/PM" : "24 hours");
  }

  function updateClock() {
    var now = new Date();
    try {
      clockElement.textContent = now.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: timeFormat === "12"
      });
    } catch (error) {
      var hourValue = now.getHours();
      var suffix = "";
      if (timeFormat === "12") {
        suffix = hourValue >= 12 ? " PM" : " AM";
        hourValue = hourValue % 12 || 12;
      }
      var hours = String(hourValue);
      var minutes = String(now.getMinutes());
      clockElement.textContent = (hours.length < 2 ? "0" : "") + hours + ":" +
        (minutes.length < 2 ? "0" : "") + minutes + suffix;
    }
    clockElement.setAttribute("datetime", now.toISOString());
  }

  function clearHeaderSelection() {
    headerButtons.forEach(function (button) {
      button.classList.remove("selected");
    });
  }

  function configHeaderIndex() {
    var index;
    for (index = 0; index < headerButtons.length; index += 1) {
      if (headerButtons[index].getAttribute("data-action") === "config") return index;
    }
    return 0;
  }

  function selectHeader(index, focus) {
    if (!headerButtons.length || moveMode) return;
    selectedArea = "header";
    selectedHeaderIndex = Math.max(0, Math.min(headerButtons.length - 1, index));
    buttons.forEach(function (button) {
      button.classList.remove("selected");
    });
    clearHeaderSelection();
    headerButtons[selectedHeaderIndex].classList.add("selected");
    if (focus !== false) headerButtons[selectedHeaderIndex].focus();
  }

  function activateHeader(index) {
    var button = headerButtons[index];
    if (!button) return;
    if (button.getAttribute("data-action") === "config") {
      openSettings();
      return;
    }
    var appId = String(button.getAttribute("data-app-id") || "");
    if (appId) launch({ id: appId, title: button.getAttribute("data-title") || button.textContent });
  }

  function openSettings() {
    settingsOpen = true;
    updateTimeFormatButton();
    settingsElement.hidden = false;
    timeFormatButton.focus();
  }

  function closeSettings() {
    settingsOpen = false;
    settingsElement.hidden = true;
    selectHeader(configHeaderIndex(), true);
  }

  function toggleTimeFormat() {
    timeFormat = timeFormat === "24" ? "12" : "24";
    saveTimeFormat();
    updateTimeFormatButton();
    updateClock();
  }

  function wireHeaderButtons() {
    headerButtons = Array.prototype.slice.call(document.querySelectorAll("#top-actions button"));
    headerButtons.forEach(function (button, index) {
      if (button._lgHomeWired) return;
      button._lgHomeWired = true;
      button.addEventListener("click", function () {
        var currentIndex = headerButtons.indexOf(button);
        if (currentIndex < 0) return;
        selectHeader(currentIndex, false);
        activateHeader(currentIndex);
      });
      button.addEventListener("mouseover", function () {
        var currentIndex = headerButtons.indexOf(button);
        if (currentIndex >= 0) selectHeader(currentIndex, false);
      });
    });
  }

  function setupHeader() {
    updateTimeFormatButton();
    updateClock();
    window.setInterval(updateClock, 15000);
    wireHeaderButtons();
    timeFormatButton.addEventListener("click", toggleTimeFormat);
  }

  function lunaCall(uri, payload, onSuccess, onFailure) {
    if (typeof window.PalmServiceBridge !== "function") {
      onFailure("PalmServiceBridge is unavailable. Run this app on an LG webOS TV.");
      return;
    }

    var bridge = new window.PalmServiceBridge();
    activeBridges.push(bridge);
    bridge.onservicecallback = function (rawResponse) {
      var index = activeBridges.indexOf(bridge);
      if (index !== -1) activeBridges.splice(index, 1);

      try {
        var response = JSON.parse(rawResponse || "{}");
        if (response.returnValue === false) {
          onFailure(response.errorText || "The TV rejected the request.");
          return;
        }
        onSuccess(response);
      } catch (error) {
        onFailure("The TV returned an invalid response.");
      }
    };

    try {
      bridge.call(uri, JSON.stringify(payload || {}));
    } catch (error) {
      var bridgeIndex = activeBridges.indexOf(bridge);
      if (bridgeIndex !== -1) activeBridges.splice(bridgeIndex, 1);
      onFailure(error && error.message ? error.message : "Unable to contact webOS.");
    }
  }

  function loadInputs() {
    var command =
      "for p in " +
      "/media/developer/apps/usr/palm/applications/com.github.int21asm.plainhome/input-reader.js " +
      "/media/cryptofs/apps/usr/palm/applications/com.github.int21asm.plainhome/input-reader.js; do " +
      "if [ -f \"$p\" ]; then exec node \"$p\"; fi; done; " +
      "printf '{\"inputs\":[]}'";

    lunaCall(
      "luna://org.webosbrew.hbchannel.service/exec",
      { command: command },
      function (response) {
        var result;
        var inputs;
        var configButton = topActionsElement.querySelector("[data-action='config']");
        var oldButtons = topActionsElement.querySelectorAll("[data-dynamic-input]");
        var index;
        try {
          result = JSON.parse(String(response.stdoutString || "{}"));
          inputs = Array.isArray(result.inputs) ? result.inputs : [];
        } catch (error) {
          return;
        }
        for (index = 0; index < oldButtons.length; index += 1) {
          oldButtons[index].parentNode.removeChild(oldButtons[index]);
        }
        inputs.forEach(function (input) {
          var button = document.createElement("button");
          button.type = "button";
          button.tabIndex = -1;
          button.setAttribute("data-dynamic-input", "true");
          button.setAttribute("data-app-id", String(input.id || ""));
          button.setAttribute("data-title", String(input.title || "Input"));
          button.textContent = String(input.title || "Input");
          topActionsElement.insertBefore(button, configButton);
        });
        wireHeaderButtons();
        selectedHeaderIndex = Math.min(selectedHeaderIndex, headerButtons.length - 1);
        if (selectedArea === "header") selectHeader(selectedHeaderIndex, true);
      },
      function () {
        /* Keep Config and TV available when input discovery fails. */
      }
    );
  }

  function titleFor(point) {
    return String(point.title || point.appTitle || point.id || point.appId || "App");
  }

  function idFor(point) {
    return String(point.id || point.appId || "");
  }

  function keyFor(point) {
    return String(point.launchPointId || idFor(point));
  }

  function readOrder() {
    try {
      var value = JSON.parse(window.localStorage.getItem(ORDER_KEY) || "[]");
      return Array.isArray(value) ? value.map(String) : [];
    } catch (error) {
      return [];
    }
  }

  function saveOrder(points) {
    try {
      window.localStorage.setItem(ORDER_KEY, JSON.stringify(points.map(keyFor)));
    } catch (error) {
      showNotice("The order changed, but webOS could not save it.");
    }
  }

  function reconcileOrder(points) {
    var byKey = {};
    var result = [];
    points.forEach(function (point) {
      byKey[keyFor(point)] = point;
    });
    readOrder().forEach(function (key) {
      if (byKey[key]) {
        result.push(byKey[key]);
        delete byKey[key];
      }
    });
    points.forEach(function (point) {
      var key = keyFor(point);
      if (byKey[key]) {
        result.push(point);
        delete byKey[key];
      }
    });
    saveOrder(result);
    return result;
  }

  function iconFor(point) {
    var candidates = [point._localIcon, point.extraLargeIcon, point.largeIcon, point.mediumLargeIcon, point.icon];
    for (var index = 0; index < candidates.length; index += 1) {
      var icon = String(candidates[index] || "");
      if (icon.indexOf("icons/") === 0) return icon;
      if (/^(https?:|data:)/i.test(icon)) return icon;
      if (icon.indexOf("/resources/") === 0) return "http://lgsmarttv.lan:3000" + icon;
    }
    return "";
  }

  function firstCharacter(title) {
    var trimmed = title.replace(/^\s+|\s+$/g, "");
    return trimmed ? trimmed.charAt(0).toUpperCase() : "•";
  }

  function makeButton(point, index) {
    var title = titleFor(point);
    var button = document.createElement("button");
    var art = document.createElement("span");
    var initial = document.createElement("span");
    var label = document.createElement("span");
    var icon = iconFor(point);

    button.type = "button";
    button.className = "app";
    button.tabIndex = -1;
    button.setAttribute("aria-label", title);
    art.className = "art";
    initial.className = "initial";
    initial.textContent = firstCharacter(title);
    label.className = "label";
    label.textContent = title;
    art.appendChild(initial);

    if (icon) {
      var image = document.createElement("img");
      image.alt = "";
      image.onload = function () {
        if (initial.parentNode) initial.parentNode.removeChild(initial);
      };
      image.onerror = function () {
        if (image.parentNode) image.parentNode.removeChild(image);
      };
      image.src = icon;
      art.appendChild(image);
    }

    button.appendChild(art);
    button.appendChild(label);
    button.addEventListener("click", function () {
      var currentIndex = buttons.indexOf(button);
      if (currentIndex < 0) return;
      select(currentIndex, false);
      if (!moveMode && !pendingRemoval) launch(launchPoints[currentIndex]);
    });
    button.addEventListener("mouseover", function () {
      var currentIndex = buttons.indexOf(button);
      if (currentIndex >= 0) select(currentIndex, false);
    });
    return button;
  }

  function render(points, preferredIndex) {
    appsElement.textContent = "";
    launchPoints = points;
    buttons = [];
    selectedIndex = Math.max(0, Math.min(points.length - 1, preferredIndex || 0));

    points.forEach(function (point, index) {
      var button = makeButton(point, index);
      buttons.push(button);
      appsElement.appendChild(button);
    });

    if (!buttons.length) {
      showStatus("No launchable apps were returned by webOS.");
      return;
    }

    hideStatus();
    select(selectedIndex, true);
  }

  function renderResponse(response) {
    var points = Array.isArray(response.launchPoints) ? response.launchPoints : [];
    var seen = {};
    points = points.filter(function (point) {
      var id = idFor(point);
      var key = String(point.launchPointId || id);
      if (!id || id === APP_ID || point.visible === false || seen[key]) return false;
      seen[key] = true;
      return true;
    });
    points = reconcileOrder(points);
    hydrateLocalIcons(points, function () {
      var preferredIndex = refreshSelectionIndex;
      if (refreshSelectionKey) {
        points.some(function (point, index) {
          if (keyFor(point) !== refreshSelectionKey) return false;
          preferredIndex = index;
          return true;
        });
      }
      refreshSelectionKey = "";
      render(points, preferredIndex);
    });
  }

  function utf8Base64(value) {
    return window.btoa(unescape(encodeURIComponent(value)));
  }

  function hydrateLocalIcons(points, done) {
    var requests = points.slice(0, 512).map(function (point) {
      return {
        key: String(point.launchPointId || idFor(point)),
        id: idFor(point),
        folderPath: typeof point.folderPath === "string" ? point.folderPath : "",
        paths: [point.extraLargeIcon, point.largeIcon, point.mediumLargeIcon, point.icon].filter(function (value) {
          return typeof value === "string" && value.length > 0;
        })
      };
    });
    var encoded = utf8Base64(JSON.stringify(requests));
    var command =
      "for p in " +
      "/media/developer/apps/usr/palm/applications/com.github.int21asm.plainhome/icon-copy.js " +
      "/media/cryptofs/apps/usr/palm/applications/com.github.int21asm.plainhome/icon-copy.js; do " +
      "if [ -f \"$p\" ]; then exec node \"$p\" '" + encoded + "'; fi; done; " +
      "printf '{\"icons\":{}}'";

    lunaCall(
      "luna://org.webosbrew.hbchannel.service/exec",
      { command: command },
      function (response) {
        try {
          var result = JSON.parse(String(response.stdoutString || "{}"));
          var icons = result.icons || {};
          points.forEach(function (point) {
            var key = String(point.launchPointId || idFor(point));
            if (typeof icons[key] === "string") {
              point._localIcon = icons[key] + "?v=0.1.14";
            }
          });
        } catch (error) {
          /* Keep the initial fallback when icon hydration fails. */
        }
        done();
      },
      function () {
        done();
      }
    );
  }

  function installClientPermissions(directError) {
    if (permissionBootstrapAttempted) {
      showStatus(
        "App permissions were registered, but webOS has not activated them yet.\n" +
        "Close PlainHome, reboot the TV, and open PlainHome again.\n" +
        directError
      );
      return;
    }
    permissionBootstrapAttempted = true;
    showStatus("Completing one-time setup…");

    var permissionFile =
      "{\"com.github.int21asm.plainhome-*\":[\"public\",\"applications.launch\",\"applications.internal\"]}";
    var command =
      "for d in /var/luna-service2-dev/client-permissions.d /var/luna-service2/client-permissions.d; do " +
      "if [ -d \"$d\" ]; then printf '%s\\n' '" + permissionFile +
      "' > \"$d/com.github.int21asm.plainhome.app.json\"; fi; done; " +
      "ls-control scan-services; " +
      "(sleep 1; " +
      "luna-send-pub -n 1 -f luna://com.webos.applicationManager/closeByAppId " +
      "'{\"id\":\"com.github.int21asm.plainhome\"}'; " +
      "sleep 1; " +
      "luna-send-pub -n 1 -f luna://com.webos.applicationManager/launch " +
      "'{\"id\":\"com.github.int21asm.plainhome\"}') " +
      "</dev/null >/tmp/plainhome-restart.log 2>&1 &";

    lunaCall(
      "luna://org.webosbrew.hbchannel.service/exec",
      { command: command },
      function (response) {
        if (response.error) {
          showStatus("Unable to register app permissions.\n" + String(response.error));
          return;
        }
        showStatus("Setup complete. Restarting PlainHome…");
      },
      function (homebrewError) {
        showStatus(
          "Unable to register app permissions.\n" +
          directError +
          "\nHomebrew helper: " +
          homebrewError
        );
      }
    );
  }

  function select(index, focus) {
    if (!buttons.length) return;
    selectedArea = "apps";
    clearHeaderSelection();
    selectedIndex = Math.max(0, Math.min(buttons.length - 1, index));
    buttons.forEach(function (button, buttonIndex) {
      if (buttonIndex === selectedIndex) button.classList.add("selected");
      else button.classList.remove("selected");
      if (moveMode && buttonIndex === selectedIndex) button.classList.add("moving");
      else button.classList.remove("moving");
    });

    var selected = buttons[selectedIndex];
    if (focus !== false) selected.focus();
    selected.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function launch(point) {
    var payload = { id: idFor(point) };
    var returnArea = selectedArea;
    var returnHeaderIndex = selectedHeaderIndex;

    lunaCall(
      "luna://com.webos.applicationManager/launch",
      payload,
      function () {},
      function (message) {
        showStatus("Could not open " + titleFor(point) + ".\n" + message);
        window.setTimeout(function () {
          hideStatus();
          if (returnArea === "header") selectHeader(returnHeaderIndex, true);
          else select(selectedIndex, true);
        }, 2800);
      }
    );
  }

  function enterMoveMode() {
    if (!launchPoints.length || moveMode || pendingRemoval) return;
    moveMode = true;
    moveSnapshot = launchPoints.slice();
    suppressEnterUp = true;
    showNotice("Move mode: arrows move • OK saves • Back cancels");
    select(selectedIndex, true);
  }

  function finishMove(save) {
    if (!moveMode) return;
    var selectedKey = launchPoints[selectedIndex] ? keyFor(launchPoints[selectedIndex]) : "";
    if (save) {
      saveOrder(launchPoints);
    } else if (moveSnapshot) {
      var buttonsByKey = {};
      launchPoints.forEach(function (point, index) {
        buttonsByKey[keyFor(point)] = buttons[index];
      });
      launchPoints = moveSnapshot.slice();
      buttons = launchPoints.map(function (point) {
        return buttonsByKey[keyFor(point)];
      });
      appsElement.textContent = "";
      buttons.forEach(function (button) {
        appsElement.appendChild(button);
      });
      launchPoints.some(function (point, index) {
        if (keyFor(point) !== selectedKey) return false;
        selectedIndex = index;
        return true;
      });
    }
    moveMode = false;
    moveSnapshot = null;
    hideNotice();
    select(selectedIndex, true);
  }

  function moveSelected(targetIndex) {
    if (!moveMode || !launchPoints.length) return;
    targetIndex = Math.max(0, Math.min(launchPoints.length - 1, targetIndex));
    if (targetIndex === selectedIndex) return;
    var moving = launchPoints[selectedIndex];
    var movingButton = buttons[selectedIndex];
    launchPoints.splice(selectedIndex, 1);
    launchPoints.splice(targetIndex, 0, moving);
    buttons.splice(selectedIndex, 1);
    buttons.splice(targetIndex, 0, movingButton);
    appsElement.textContent = "";
    buttons.forEach(function (button) {
      appsElement.appendChild(button);
    });
    select(targetIndex, true);
  }

  function requestRemoval(point) {
    if (!point || pendingRemoval || moveMode) return;
    if (point.removable !== true) {
      showNotice("This app is protected or webOS does not mark it removable.");
      window.setTimeout(hideNotice, 2600);
      return;
    }
    pendingRemoval = point;
    confirmMessageElement.textContent = "Uninstall " + titleFor(point) + " from the TV?";
    confirmElement.hidden = false;
  }

  function cancelRemoval() {
    pendingRemoval = null;
    confirmElement.hidden = true;
    select(selectedIndex, true);
  }

  function confirmRemoval() {
    var point = pendingRemoval;
    if (!point) return;
    var appId = idFor(point);
    if (appId === APP_ID || !/^[A-Za-z0-9._-]+$/.test(appId)) {
      cancelRemoval();
      showNotice("Removal blocked: invalid or protected app ID.");
      window.setTimeout(hideNotice, 2800);
      return;
    }

    pendingRemoval = null;
    confirmElement.hidden = true;
    showStatus("Removing " + titleFor(point) + "…");
    refreshSelectionIndex = selectedIndex;
    var payload = "{\"subscribe\":true,\"id\":\"" + appId + "\"}";
    var command =
      "luna-send -a com.webos.app.home -w 15000 -i " +
      "luna://com.webos.appInstallService/remove '" + payload + "'";

    lunaCall(
      "luna://org.webosbrew.hbchannel.service/exec",
      { command: command },
      function (response) {
        var output = String(response.stdoutString || "");
        if (response.error || output.indexOf('"returnValue":false') !== -1) {
          showStatus("Could not remove " + titleFor(point) + ".\n" + String(response.error || output));
          window.setTimeout(function () {
            hideStatus();
            select(selectedIndex, true);
          }, 3500);
          return;
        }
        window.setTimeout(function () {
          loadApps();
        }, 1000);
      },
      function (message) {
        showStatus("Could not remove " + titleFor(point) + ".\n" + message);
        window.setTimeout(function () {
          hideStatus();
          select(selectedIndex, true);
        }, 3500);
      }
    );
  }

  function loadApps() {
    loadInputs();
    if (launchPoints[selectedIndex]) refreshSelectionKey = keyFor(launchPoints[selectedIndex]);
    refreshSelectionIndex = selectedIndex;
    if (moveMode) {
      saveOrder(launchPoints);
      moveMode = false;
      moveSnapshot = null;
    }
    hideNotice();
    showStatus("Loading apps…");
    lunaCall(
      "luna://com.webos.applicationManager/listLaunchPoints",
      { subscribe: false },
      renderResponse,
      function (message) {
        installClientPermissions(message);
      }
    );
  }

  function handleKeyDown(event) {
    var key = event.key;
    var code = event.keyCode;
    var next = selectedIndex;

    if (settingsOpen) {
      if (key === "Enter" || code === 13) {
        event.preventDefault();
        suppressEnterUp = true;
        toggleTimeFormat();
      } else if (key === "Escape" || key === "Backspace" || code === 27 || code === 8 || code === 461) {
        event.preventDefault();
        closeSettings();
      }
      return;
    }

    if (pendingRemoval) {
      if (key === "Enter" || code === 13) {
        event.preventDefault();
        suppressEnterUp = true;
        confirmRemoval();
      } else if (key === "Escape" || key === "Backspace" || code === 27 || code === 8 || code === 461) {
        event.preventDefault();
        cancelRemoval();
      }
      return;
    }

    if (selectedArea === "header") {
      if (key === "ArrowLeft" || code === 37) {
        event.preventDefault();
        selectHeader(selectedHeaderIndex - 1, true);
      } else if (key === "ArrowRight" || code === 39) {
        event.preventDefault();
        selectHeader(selectedHeaderIndex + 1, true);
      } else if (key === "ArrowDown" || code === 40) {
        event.preventDefault();
        select(Math.min(buttons.length - 1, selectedHeaderIndex), true);
      } else if (key === "Enter" || code === 13) {
        event.preventDefault();
        suppressEnterUp = true;
        activateHeader(selectedHeaderIndex);
      } else if (key === "Escape" || key === "Backspace" || code === 27 || code === 8 || code === 461) {
        event.preventDefault();
        window.close();
      } else if (code === 403 || key === "ColorF0Red") {
        event.preventDefault();
        loadApps();
      }
      return;
    }

    if (key === "ArrowLeft" || code === 37) next -= 1;
    else if (key === "ArrowRight" || code === 39) next += 1;
    else if (key === "ArrowUp" || code === 38) {
      if (!moveMode && selectedIndex < COLUMNS) {
        event.preventDefault();
        selectHeader(selectedHeaderIndex, true);
        return;
      }
      next -= COLUMNS;
    }
    else if (key === "ArrowDown" || code === 40) next += COLUMNS;
    else if (key === "Enter" || code === 13) {
      event.preventDefault();
      if (event.repeat) return;
      if (moveMode) {
        suppressEnterUp = true;
        finishMove(true);
        return;
      }
      suppressEnterUp = false;
      window.clearTimeout(enterTimer);
      enterTimer = window.setTimeout(function () {
        enterTimer = null;
        enterMoveMode();
      }, LONG_PRESS_MS);
      return;
    } else if (key === "Escape" || key === "Backspace" || code === 27 || code === 8 || code === 461) {
      event.preventDefault();
      if (moveMode) {
        suppressEnterUp = true;
        finishMove(false);
        return;
      }
      window.close();
      return;
    } else if (code === 403 || key === "ColorF0Red") {
      event.preventDefault();
      loadApps();
      return;
    } else if (code === 405 || key === "ColorF2Yellow") {
      event.preventDefault();
      requestRemoval(launchPoints[selectedIndex]);
      return;
    } else {
      return;
    }

    event.preventDefault();
    if (moveMode) moveSelected(next);
    else select(next, true);
  }

  function handleKeyUp(event) {
    var key = event.key;
    var code = event.keyCode;
    if (key !== "Enter" && code !== 13) return;
    event.preventDefault();
    if (enterTimer) {
      window.clearTimeout(enterTimer);
      enterTimer = null;
      if (!suppressEnterUp && selectedArea === "apps" && launchPoints[selectedIndex]) {
        launch(launchPoints[selectedIndex]);
      }
    }
    suppressEnterUp = false;
  }

  document.addEventListener("keydown", handleKeyDown, false);
  document.addEventListener("keyup", handleKeyUp, false);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) {
      updateClock();
      if (settingsOpen) timeFormatButton.focus();
      else if (selectedArea === "header") selectHeader(selectedHeaderIndex, true);
      else if (buttons.length) select(selectedIndex, true);
    }
  });
  window.addEventListener("load", function () {
    setupHeader();
    loadApps();
  }, false);
}());
