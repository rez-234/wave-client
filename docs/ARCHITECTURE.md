# Wave Client architecture

Wave Client is a Minecraft Java Edition PvP / quality-of-life client in two parts:

- **mod/**: a Fabric client mod for Minecraft 1.21.11 (Java 21, Mojang mappings).
- **launcher/**: an Electron + TypeScript desktop launcher, shipped as a Windows installer.

No Minecraft game files are bundled or redistributed. The launcher downloads vanilla
jars, libraries and assets from Mojang's official endpoints at runtime and verifies them.

## Decisions

| Topic | Decision |
|---|---|
| Minecraft version | 1.21.11, the last 1.21.x release. |
| Mappings | Official Mojang mappings. Fabric doesn't support Yarn on 26.x, so a later port is mostly a version bump. |
| Build | Fabric Loom 1.17 (`net.fabricmc.fabric-loom-remap`), Gradle 9.5, JDK 21. |
| Mod id / package | `waveclient` / `dev.waveclient` |
| Accent color | `#5B8CFF` |
| Freelook | Built, but blocked by server policy on Hypixel. Snaplook is the always-allowed alternative. |
| Launcher stack | Electron + TypeScript + React (electron-vite), electron-builder |
| Distribution | NSIS installer for Windows (`WaveClient-Setup-<version>.exe`) |

## Fair-play policy

Only features generally allowed on major servers: no combat automation, reach, x-ray, ESP
or anything else that gives a gameplay advantage. A server-policy layer forces modules off
on servers that disallow them. For example, freelook is off on `hypixel.net` and its
subdomains. A forced-off module keeps its saved setting and shows as unavailable.

## Repository layout

```
wave-client/
├─ mod/                       Fabric client mod (Gradle + Loom)
├─ launcher/                  Electron app (TypeScript)
├─ shared/design-tokens.json  colors, type scale, spacing for both UIs
├─ docs/ARCHITECTURE.md
└─ .github/workflows/         CI: build mod, test launcher, build installer
```

## Mod

### Packages (`dev.waveclient`)

| Package | Contents |
|---|---|
| `WaveClient` | Client entrypoint. Wires config, modules, input and events. |
| `module` | `Module`, `Category`, `ModuleManager`, `ServerPolicy`, `SettingContainer` |
| `module.impl.*` | Modules, grouped by category |
| `setting` | `Setting` (sealed), `BooleanSetting`, `SliderSetting`, `ColorSetting`, `KeybindSetting`, `EnumSetting` |
| `input` | `Keybind`, `KeybindDispatcher`, `KeyMode`, `HoldToggle`, `ClickInput` |
| `config` | `ConfigManager`, `ConfigSerializer`, `ConfigMigrations`, `AtomicFiles` |
| `hud` | `HudModule`, `TextHudModule`, `HudPosition`, `Anchor`, `HudLayer`, `SnapEngine`, `CachedText`, `CachedComponent`, `VanillaElementGate`, `HudDefaults` |
| `gui` | `theme` (tokens, fonts), `render` (`Painter`, `Text`), `widget`, `menu` (`ModMenuScreen` and its pages), `screen` (`HudEditorScreen`), `PauseMenuButton` |
| `command` | `/wave` client command (list, toggle, get/set settings, save/reload) |
| `compat` | Optional integrations (Mod Menu, Iris's shader-pack check), used only when present |
| `mixin` | Mixins and accessors |

Code in `module`, `setting`, `input` and `config` (and the math in `hud`) does not import
Minecraft classes, so it is covered by plain JUnit tests.

### Module system

- A `Module` has an id, name, description and category, plus an ordered list of settings.
  Every module gets a `toggleKey` setting, unbound by default.
- **Enabled vs active.** `enabled` is what the user chose and is saved. `active` means
  enabled, not blocked by server policy, and client started. Mixins check `isActive()`.
- **Lifecycle.** `onEnable`/`onDisable` run when `active` changes. Before the client has
  finished starting, enabling only records the state; `ModuleManager.start()` activates
  modules once the game is ready. `onTick` runs only for active modules, which are kept in
  a prebuilt array that's rebuilt when something toggles.
- **Hooks.** There is no reflection-based event bus. Mixins call the module's `isActive()`
  (a field read) and return early when it's off. Ticks, HUD, screens and connections use
  Fabric API events.

### Settings

`BooleanSetting`, `SliderSetting` (double, min/max/step), `ColorSetting` (ARGB),
`KeybindSetting` (key or mouse button) and `EnumSetting`. Getters return primitives, so
reading a setting while rendering never allocates. Each setting:

- clamps or rejects invalid values instead of throwing;
- reads JSON leniently (wrong type or missing means default);
- can parse a string for the `/wave set` command;
- notifies its owner on change, which marks the config dirty.

### Keybinds

Module binds are handled by `KeybindDispatcher`, not by vanilla key mappings, so the
vanilla Controls screen isn't flooded. A `KeyboardHandler.keyPress` / `MouseHandler.onButton`
mixin forwards raw GLFW events. Presses fire only while no screen is open; releases are
always processed so held keys never get stuck. Binds are stored as `key:<glfw code>`,
`mouse:<button>` or `none`, so the format never depends on Minecraft version.

### Config

- File: `config/waveclient/config.json` in the game directory.
- Shape: `{ "schemaVersion", "client": {settings}, "modules": { id: { "enabled", "settings", "hud" } } }`.
- `schemaVersion` with step-by-step migrations.
- Unknown keys are ignored and missing keys use defaults. A corrupt file is renamed to
  `config.json.corrupt-<timestamp>` and defaults are loaded, so a bad config never crashes
  the game.
- Saving is debounced: about 1s after the last change, plus on shutdown. The snapshot is
  built on the game thread and written on a background thread to a temp file, then moved
  into place atomically.

### HUD

- One Fabric HUD layer, attached before the vanilla chat layer, draws all active HUD modules.
  It inherits F1 hiding, draws under chat and the tab list, and hides while F3 is open
  (client setting `hideHudWithDebug`), except elements that stand in for a vanilla one vanilla
  keeps under F3 (scoreboard, potion effects that hide vanilla's icons). Vanilla elements we
  replace (crosshair, status effects, scoreboard) go through Fabric API's `replaceElement`.
- **Position:** one of 9 anchors, plus an offset in GUI-scaled pixels from that anchor to
  the same point on the element, plus a scale from 0.5 to 3.0. The anchor is chosen from
  where the element is dropped. Elements are clamped on screen when drawn.
- **Text caching:** each element rebuilds its text only when its source value changes. The
  display-ordered text and its width are cached, so drawing passes no plain Strings (which
  would be re-processed every frame). Widths are re-measured once a second to pick up font or
  language changes.

### HUD editor (Right Shift)

Drag to move, use the corner handle or scroll to scale, arrow keys to nudge (Shift: 10px), R to
reset the selected element. Elements snap within 4px to screen edges, the screen's center lines,
and other elements' edges and centers, with guide lines drawn; hold Alt to disable snapping.
Buttons: "Mods", "Reset all" and "Done"; right-click an element to open its settings in the mod
menu. Returning from the menu refreshes the element list, since modules may have been toggled.

The behaviour lives in `HudEditController`, `SnapEngine` and `ToggleKeyGesture`, which use no
Minecraft types and are unit tested; `HudEditorScreen` forwards input to them and draws. Edited
positions are stored on whole GUI pixels, so saving and reloading never moves an element. The editor opens on the tick after
the key press. Inside the editor the key closes it on release, and only for a press made in the
editor with nothing else pressed meanwhile, so neither key auto-repeat nor Right Shift + arrow
(the 10px nudge) closes it by accident. A click never moves anything: drags start after 2px.
Only active elements are shown, so a module blocked by the server stays hidden.

### Mod menu

The mod menu has a category sidebar, search, module cards with switches, and a settings page
per module (and one for the client's own settings) with our own widgets: switch, slider, color
picker, key capture, dropdown, text field. It opens from the HUD editor (Mods button, or
right-click an element), a pause-menu button, its own bind (unbound by default), and Mod
Menu's Configure button. It uses the same design tokens as the launcher.

- **Own widgets, own input routing.** `ModMenuScreen` draws and hit-tests everything itself
  (`gui.widget.Widget`, not vanilla widgets), so every input path is explicit: an open popover
  gets events first, then a key binding waiting for a key, then the focused widget, then the
  screen's shortcuts. Escape closes the popover, cancels key capture, clears a focused search,
  or closes the menu, in that order. Logic with no Minecraft types (`ModuleSearch`,
  `ScrollState`, `TextFieldModel`, `ColorPickerModel`, `KeyCapture`, `ButtonPlacement`,
  `CornerMask`) is unit tested.
- **Layering.** Content scrolls inside a scissor with the pose translated by the scroll offset;
  popovers and tooltips are drawn after `nextStratum()` so they sit above all earlier text.
  No background blur: a flat dim in a world, an opaque background on the title screen.
- **Shapes.** `Painter` draws rounded rectangles in screen pixels (pose scaled by 1/GUI scale)
  with anti-aliased corners, so corners match the launcher's CSS radii instead of a staircase
  of GUI pixels. The color picker's square is one vertical gradient per screen-pixel column,
  which is exact because RGB is linear in HSV value.
- **Text.** Inter Medium (body) and SemiBold (labels, titles), subset to Latin, Greek,
  Cyrillic and common symbols, with the vanilla font as fallback for other characters.
  Minecraft rasterises a TTF once at `size * oversample` and samples it with nearest
  filtering, so text is only sharp when every glyph texel covers a whole block of screen
  pixels. Each style therefore ships one font definition per GUI scale from 2 to 10
  (`assets/waveclient/font/ui/`) and the menu picks the current one; above 10 it uses a
  definition whose oversample divides the scale (12 uses 6, 14 uses 7). GUI scale 1, and large
  scales with no such divisor (11, 13, 17...), use the vanilla font, as does the menu if Inter
  fails to load (detected by measuring "iiii" against "WWWW"). Styled text and its measurements are
  cached in `Text` and rebuilt when the GUI scale, font or resources change.
- **Pause menu button.** A 20x20 icon button added in a late `ScreenEvents.AFTER_INIT` phase,
  4px left of "Options..." (found by translation key), with fallbacks that never overlap any
  visible button, so it coexists with every Mod Menu layout. Toggle: client setting
  `pauseMenuButton`.
- **Mod Menu.** `compat.ModMenuIntegration` is the `modmenu` entrypoint. It compiles against
  stand-in interfaces in the `modmenuApi` source set (compile classpath only, not in the jar),
  so builds never download Mod Menu; `-Pcompat` runs the real Mod Menu in dev.
- **State.** The menu remembers its section, open module and scroll positions while the game
  runs (not across restarts). The config is saved when the menu closes.

### Feature hooks

| Module | Hook |
|---|---|
| Fullbright | Modifies the gamma value read in `LightTexture.updateLightTexture` (sliced from the `Options.gamma()` call); never writes the option. With setting `shaderPacks`, also answers `GameRenderer.getNightVisionScale` with 1 for the local player/camera entity, which Iris passes to shader packs |
| Zoom | `GameRenderer.getFov` (world FOV only, not the hand; min 1 degree), `GameRenderer.bobView` (damps bobbing while zoomed), `MouseHandler.onScroll` (at `LocalPlayer.isSpectator()`), `MouseHandler.turnPlayer` (scales `accumulatedDX/DY`, reads `Options.smoothCamera`) |
| FPS, ping, coords, direction, clock, keystrokes, armor | HUD layer only. Keystrokes polls the bound keys with GLFW each frame (no state written) |
| CPS | Counts at the `KeyMapping.click` calls in `MouseHandler.onButton` and `KeyboardHandler.keyPress` (presses only, no screen open; vanilla always runs) |
| Potion effects | HUD layer; `replaceElement(STATUS_EFFECTS)` with one preallocated gate that hides the vanilla icons while the module is on |
| Toggle sprint / sneak | Our own toggle state, applied to the `Input` that `KeyboardInput.tick` builds (`@WrapOperation` on the constructor). Presses come from the raw key and mouse hooks. Vanilla's toggle options and `ToggleKeyMapping` are never touched |
| Freelook / Snaplook | `Options.getCameraType` returns an override (one static field read; the option is never written). `Minecraft.handleKeybinds` reads the real perspective so F5 still cycles it, and ends either mode. Freelook also replaces the rotation `Camera.setup` reads and takes the mouse at the `LocalPlayer.turn` call in `MouseHandler.turnPlayer`. Freelook is policy-gated |
| Custom crosshair | `replaceElement(CROSSHAIR)` with one preallocated element. Draws only when vanilla would (its first-person, spectator and F3 3D-crosshair checks, through a `Gui` invoker), otherwise runs the original. The shape is baked into disjoint rectangles drawn as one or two GUI elements (`GUI_INVERT` for the vanilla invert look), reused across frames |
| Motion blur | `GameRenderer.render` after `LevelRenderer.doEntityOutline` (world finished, GUI not yet drawn): one full-screen pass blending the frame with a kept 8-bit image, frame-time weighted. Own unregistered pipeline, so a broken shader turns it off instead of failing a reload. Off while an Iris shader pack is in use (Iris API by reflection) |
| Chat tweaks | `ChatComponent.addMessage`: the message argument at HEAD (timestamp) and the `logChatMessage` call (log stays unstamped); the history constant in `addMessageToQueue` and `addMessageToDisplayQueue`; the `clearMessages` call in `Gui.onDisconnected` (keep chat); `ChatScreen.mouseClicked` at its `button()` call (copy), hit-testing through `captureClickableText` |
| Scoreboard | `replaceElement(SCOREBOARD)` gate plus a HUD module drawn by the HUD layer; the scoreboard is read once a tick; no mixins |
| Item physics | `ItemEntityRenderer.extractRenderState` TAIL (decides the pose, replays the stack's seeded copy offsets and measures the fluid surface), and `@WrapOperation` on the single `translate` and `mulPose` in `submit`; the tumble angle lives in `@Unique` fields on `ItemEntity` |

### Compatibility

- Only MixinExtras injectors (`@ModifyExpressionValue`, `@WrapOperation`, `@ModifyReturnValue`,
  `@Inject`). No `@Redirect` or `@Overwrite`.
- Nothing touches terrain/chunk rendering, block models or the video settings screen
  (Sodium). Lithium only changes game logic.
- Iris is an optional dependency, used only when installed.
- `./gradlew runClient -Pcompat` runs with Sodium, Lithium, Iris and Mod Menu.

## Launcher

`launcher/` is an electron-vite project (Electron 44, React 19, TypeScript strict, Vitest).
All network, file and process work happens in the main process; the renderer only talks to the
typed `window.wave` API (`src/shared/ipc.ts`).

### Main-process modules

| Module | Responsibility |
|---|---|
| `net/http` | fetch wrapper (Electron `net.fetch`, so the system proxy applies): a deadline for the answer (and for small JSON and text bodies), cancellation, `Retry-After`-aware retries for idempotent requests; every transport failure becomes one `NetworkError` (Electron reports them as plain `net::ERR_*` errors); errors never echo request bodies or query strings |
| `net/downloads` | Parallel queue: `.part` file, size + SHA-1 check, atomic rename, per-file retries, skip valid files, re-hash everything in repair mode; no limit on a whole file, but one that receives nothing for 30 s is dropped; a full or read-only disk isn't retried; a cancel returns only once every worker has stopped |
| `auth/microsoft` | Microsoft identity platform v2 (`consumers`): auth code + PKCE S256 in the system browser with a loopback redirect (listen on 127.0.0.1, redirect `http://localhost:<port>`, state and Host checked); device code fallback; rotated refresh tokens |
| `auth/xbox-minecraft` | Xbox Live user token (`d=` ticket) → XSTS for `rp://api.minecraftservices.com/` (XErr codes mapped to messages) → `login_with_xbox` ("Invalid app registration" recognised, never retried) → profile (404 explained via entitlements) |
| `auth/service` | Sign-in chain; refresh before launch when < 12 h of the 24 h token remain, one refresh per account at a time, rotated refresh token saved first, `invalid_grant` or a changed app id → "sign in again", still-valid token used during an outage |
| `accounts/store` | `accounts.dat` encrypted with `safeStorage`; not written at all when only Linux's insecure `basic_text` backend exists (session-only accounts); saves queued one at a time; a file that can't be decrypted is left for a later start and set aside (never overwritten) only if something new is saved; every change is pushed to the window |
| `game/version` | Version JSON rules (last match wins, `x86` = 32-bit JVM, features), `inheritsFrom` merge (scalars from the child, arguments parent then child, libraries child first and de-duplicated by group:artifact:classifier, as Fabric's Knot refuses duplicate ASM), argument templating |
| `game/java` | Mojang's Java runtime index and per-component manifests (verified), files, executable bits, links kept inside the runtime; every file re-hashed when Mojang updates the runtime (an updated file can keep its size); the manifest saved with the runtime for offline checks; clear error where Mojang ships none (32-bit, Linux on ARM); probes a user-chosen Java and runs a chosen `java.exe` as the `javaw.exe` beside it |
| `game/fabric`, `game/client-mods` | Fabric meta profile (cached for offline use); Maven `.sha1` fetched for the loader, intermediary and Fabric API (which the profile leaves unhashed) and saved next to the jars; `client/` holds exactly our mod and the pinned Fabric API for `-Dfabric.addMods` |
| `game/assets` | Asset index (always re-hashed: Mojang changed index 29 without changing its id) and objects |
| `game/install` | The whole install in order, with progress per phase |
| `game/launch-command` | JVM args from the version (with `-cp`), log4j config, `-Xms/-Xmx`, `-Dfabric.addMods`, user JVM args last (HotSpot keeps the last copy of a flag), main class, game args; every placeholder must be filled; `--xuid` from the token's claim, `--clientId` a per-install id |
| `game/process`, `game/log-parser`, `game/crash` | Spawn without a shell, parse log4j XML events from stdout (plus plain lines), redact the token; on exit find the crash report (only inside the game's `crash-reports/`), `hs_err` log, Fabric resolution errors and suspect mods; a forced quit from the launcher is not a crash |
| `controller`, `ipc`, `index` | One game at a time; the last 5000 lines of output across launches, each numbered by launch; IPC calls accepted only from the app's own window and page; the crash card opens only the shown crash's own files; window hardening |

An installed game starts without the network: every file was hash-checked when installed, and
the metadata and hashes it was checked against are saved. A Minecraft token that is still valid
is used when refreshing it fails for lack of a connection.

Pinned versions (`game/pins.ts`, checked against `mod/gradle.properties` by a test): Minecraft
1.21.11, Fabric Loader 0.19.5, Fabric API 0.141.6+1.21.11.

### Disk layout

```
%APPDATA%/WaveClient/
  launcher.json, accounts.dat (encrypted), install-id, logs/launcher.log
  shared/{versions,libraries,assets,runtimes}/
  client/                      our mod + managed Fabric API
  instances/<profile>/         game directory (mods/, config/, saves/, logs/, crash-reports/ ...)
  electron/                    Chromium's own data
```

### Security

- Window: `contextIsolation`, `sandbox`, no `nodeIntegration`; the preload is one CommonJS file
  exposing only `window.wave`. The built page is served from its own `wave://launcher/` origin,
  not `file://` (which could read any local file, and whose URLs Node and Chromium spell
  differently for some folder names). New windows, navigation away from the app page, webviews
  and permission requests are denied (clipboard writes allowed for Copy buttons). Strict CSP in
  the page, with no network requests at all (`connect-src 'none'`; the dev server adds its
  websocket).
- IPC: every handler checks the sender is the main window's top frame on the app's own page and
  validates arguments; only plain messages cross back. Help links open in the browser only for
  https Microsoft, Xbox and Minecraft hosts. The page can't choose what runs: a Java is set only
  through the native file picker, and JVM options other than known-harmless shapes (memory and
  GC tuning, boolean `-XX` flags, ordinary `-D` properties) are saved only after the player
  confirms them in a native dialog. That covers anything that runs commands or loads agents,
  classes or native libraries (`-XX:OnError`, `-javaagent`, `-Xrun`, `-cp`, `-p`/`-m`, argument
  files, `-Dfabric.addMods`, `-Dorg.lwjgl.*`, JMX) in any spelling. A crash file is opened only if it's the shown crash's
  own report or JVM log.
- Quitting while the game runs asks first (macOS Cmd+Q); starting Wave Client again, or the
  Dock icon, brings the window back.
- Tokens: never sent to the renderer, never logged (redacted from game output and errors),
  stored only through the OS keychain.

### Tests

Unit tests use real Mojang/Fabric metadata as fixtures (`launcher/test/fixtures`). CI
(`.github/workflows/launcher.yml`) also starts the real Electron app under xvfb with the
sandbox on, and runs an end-to-end job that installs 1.21.11 + Fabric + Java + assets + our mod
from the official servers with the launcher's own code and launches the game until the mod
initializes.

### Installer

- electron-builder NSIS target produces `WaveClient-Setup-<version>.exe`.
- Per-user install by default, so no admin prompt. Location is `%LOCALAPPDATA%\Programs\Wave Client`.
- Creates Start menu and desktop shortcuts and registers an uninstaller in "Apps & features".
  Uninstalling keeps game data unless the user ticks "Remove game data".
- The mod jar is built first and bundled as an extra resource. The launcher copies it into
  `client/` on first run and after updates.
- Built by GitHub Actions on a Windows runner and attached as a workflow artifact (and to
  releases on tags).
- Electron fuses flipped at packaging: `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`,
  `EnableNodeCliInspectArguments` and `GrantFileProtocolExtraPrivileges` off, asar integrity
  validation and `OnlyLoadAppFromAsar` on.
- Unsigned until a code-signing certificate is added, so Windows SmartScreen will warn on
  first run.

## Order of work

1. Mod skeleton, module system, config saving
2. Fullbright, zoom, FPS/coords HUD
3. HUD editor
4. Mod menu
5. Remaining modules
6. Launcher: auth, downloads, Fabric install, launch
7. Launcher mod manager and profiles
8. Windows installer and CI release build
