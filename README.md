# PlainHome

A deliberately minimal launcher for LG webOS TVs:

- black background
- dynamically lists launchable installed apps
- large icons in a compact six-column grid
- persistent custom app order with new apps appended automatically
- guarded removal of apps that webOS explicitly marks removable
- scrollable top bar with a live clock, connected named HDMI inputs, and a Config menu
- persistent 24-hour or AM/PM clock setting
- D-pad, Enter, Back, Magic Remote pointer and wheel scrolling
- no boot hook and no Home-button replacement

## Requirements

PlainHome currently requires a **rooted webOS TV with Homebrew Channel installed and its root service enabled**. Installing the IPK through LG Developer Mode on an unrooted TV is not sufficient: application discovery, icon access, connected-input detection, and app removal depend on rooted Homebrew services.

Unrooted TVs are not supported by the current release.

## Build

Run:

```sh
./build.sh
```

The IPK and Homebrew manifest are written to `dist/`.

## Install and test

Install the IPK using webOS Dev Manager, then launch **PlainHome** from the normal launcher or Homebrew Channel.

Alternatively, run `./deploy-tv.sh`. It prompts for the TV address, SSH password and version, uploads and installs that IPK, then keeps only the two highest PlainHome IPK versions in the TV's `/tmp`. Values may also be supplied through `TV_HOST`, `TV_USER`, and `TV_PASSWORD` environment variables.

The app first requests the catalog directly. On firmware that blocks the request, it uses the rooted Homebrew Channel's documented `/exec` helper once to register the narrow Luna permissions required by this app. It creates `com.github.int21asm.plainhome.app.json` in the TV's existing Luna client-permissions directories, rescans Luna manifests, and restarts only PlainHome. It does not add a boot hook or modify system application files.

Because webOS blocks one app from reading another app's icon, the Homebrew helper also runs the bundled `icon-copy.js`. That helper accepts only icon files contained in known webOS application roots, limits files to 2 MB, and copies them into PlainHome's own `icons/` directory. No system-owned file is changed.

## Controls

- Arrow keys: move
- Enter / remote wheel click: launch
- Hold Enter / OK: enter move mode; arrows reposition, OK saves, Back cancels
- Red button: refresh the installed-app list
- Yellow button: remove the selected app when webOS marks it removable (confirmation required)
- Back: close PlainHome
- Magic Remote pointer: point and click

## Development disclosure

OpenAI Codex assisted with development. The maintainer is responsible for reviewing, testing, and publishing the code.
