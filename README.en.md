# dsh-chat-enter-newline

A DSH plugin that lets each of `Enter` / `Shift+Enter` / `Ctrl(Cmd)+Enter` be assigned to **send the message** or **insert a line break**, and adds an "Composer keys" row to Settings → General.

English | [中文](README.md)

## Why it exists

DSH registers "send message" and "insert newline" as **fixed input operations** (`registerFixed()`): they appear in the Settings → Keyboard shortcuts sheet for display, key reservation and conflict checking, but deliberately carry no override and cannot be re-recorded. The actual key decision is hard-coded in the composer's Enter command.

This plugin does not touch the engine keymap and does not take over those read-only rows. Instead it **rewrites the modifier flags on the original event** during the document capture phase, so the engine itself reads the other gesture: the event stays trusted, nothing is `preventDefault`-ed, propagation is untouched, and "send" and "line break" keep their engine-defined meaning.

## How it differs from similar plugins

Several community plugins already cover this (`dsh-composer-keys`, `dsh-keys-setting`, `dsh-composer-enter`, `dsh-ctrl-enter-submit`, `dsh-enter-swap`, ...). This one optimises for **minimal, auditable**:

- **No host HTTP route.** The host half is 25 lines: declare one `volatile` Config and declare that the UI ships its own surface. No routes, services, listeners or timers.
- **Modifiers only, no synthetic events.** No `KeyboardEvent` re-dispatch, no Lexical internals, no direct DOM writes; `isTrusted` and the propagation chain are unchanged.
- **Defaults identical to the engine.** Defaults *are* the engine keymap, so an unmodified install intercepts nothing.
- **No build step.** The browser half is a hand-written `window.__ModuleLoader__.load({ id, factory })` bundle that only `require`s `react`.
- **Minimal dependencies.** One runtime dependency, the engine's own `@deepseek-ai/schemastery`, for the Config schema.

The trade-off is scope: no interrupt key, no binding presets, no arbitrary custom chords — use the fuller implementations above for that.

## Behaviour

| Gesture | Default (matches the engine) | Configurable to |
|---|---|---|
| `Enter` | Send message | Line break |
| `Shift+Enter` | Line break | Send message |
| `Ctrl/Cmd+Enter` | Send message | Line break |

Nothing is rewritten while the preference equals the engine default, so installing changes no habit. `Ctrl+Shift+Enter` folds into the Shift gesture (the engine keymap matches Shift first).

It only acts inside the main composer (`[data-composer-input="true"]`). Queue editors and question cards are untouched. IME composition (`isComposing`, `keyCode 229`) and any `Alt` chord pass through; while the `/` or `@` menu is open, `Enter` belongs to the menu.

## Where the preference lives

- Namespace: `chat-enter-newline` (equal to the Loader entry id in `cordis.patch.yml`)
- Fields: `enter` / `shiftEnter` / `ctrlEnter`, each `send` or `newline`
- Stored in: `$DSH_HOME/profiles/<profile>/cordis.patch.yml`

Writes from the settings row apply immediately, no restart. You can also edit the file by hand:

```yaml
- id: chat-enter-newline
  name: dsh-chat-enter-newline
  config:
    enter: newline     # only list the gestures you override
    ctrlEnter: send
```

## Install

```sh
dsh plugin --profile <profile> add github:tshchief/dsh-chat-enter-newline
dsh plugin --profile <profile> add file:<absolute path to this directory>

dsh plugin --profile <profile> remove dsh-chat-enter-newline
```

The desktop app runs the `desktop` profile; `dsh web` runs `web`. After installing, refresh the page (a restart is only needed if the row does not appear). Editing this directory requires re-running the install: `file:` copies files, it does not symlink.

## Verified against

| DSH | Platform | Status |
|---|---|---|
| `0.2.0-rc.2` | Windows desktop (Web GUI) | Tested: settings write, `Enter` newline, `Ctrl+Enter` send |
| `0.2.1-rc.2` | Windows desktop (Web GUI) | Engine contract check 8/8, install and settings-row registration verified; key behaviour awaiting a human re-test |

Other versions are unverified. `peerDependencies` declares `@deepseek-ai/dsh: ^0.2.0-rc.2` (the range covers 0.2.x prereleases; 0.2.1-rc.2 passes the install check) — that is the compatibility check the engine actually enforces (`evaluatePluginCompatibility` only inspects `@deepseek-ai/dsh*` peers). A `dsh.compatibility.dshReleases` map is also present as community-store metadata; the engine ignores it.

## Engine contracts this plugin depends on

```sh
node tools/asar.mjs check   # reads the installed app.asar; override with --archive= or $DSH_ASAR
```

It verifies: the `data-composer-input` / `data-composer-card` / `data-trigger-menu` attributes, the `event.shiftKey` split in the composer's Enter command, `settings.general.item` plus `configForms.get()/whileServed()`, the `hooks` compartment, and `schemastery`'s `volatile()`.

## Development

```sh
node --check index.js && node --check client.js
node test.mjs              # 27 logic assertions
node tools/asar.mjs check  # engine contract self-check
```

## Known limitations

- The Settings → Keyboard shortcuts sheet still shows `Enter` / `Shift+Enter` as read-only; those are engine-owned fixed rows and no plugin can rewrite them, so the two surfaces disagree by design.
- The preference is per device and platform, like the engine's own key overrides.
- It does not change what "busy Enter" means (queue vs steer); that is the engine's own `composer-enter` row under Settings → General.
- It depends on the DOM attributes and slot names listed above. On a breaking engine change the failure mode is "silently does nothing", not broken native behaviour.

## License

MIT, see [LICENSE](LICENSE).
