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
| `input` | `Keybind`, `KeybindDispatcher` |
| `config` | `ConfigManager`, `ConfigSerializer`, `ConfigMigrations`, `AtomicFiles` |
| `hud` | `HudModule`, `HudPosition`, `Anchor`, `HudLayer`, `SnapEngine`, `CachedText` |
| `gui` | `theme` (tokens, fonts), `render` (`Painter`, `Text`), `widget`, `menu` (`ModMenuScreen` and its pages), `screen` (`HudEditorScreen`), `PauseMenuButton` |
| `command` | `/wave` client command (list, toggle, get/set settings, save/reload) |
| `compat` | Optional integrations (Mod Menu), loaded only when present |
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
  (client setting `hideHudWithDebug`). Vanilla elements we replace (crosshair, status effects,
  scoreboard) go through Fabric API's `replaceElement`.
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
  filtering, so text is only sharp when oversample equals the GUI scale. Each style therefore
  ships one font definition per GUI scale (2 to 10, `assets/waveclient/font/ui/`) and the menu
  picks the current one. GUI scale 1 uses the vanilla font, and so does the menu if Inter fails
  to load (detected by measuring "iiii" against "WWWW"). Styled text and its measurements are
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
| FPS, CPS, ping, coords, direction, clock, keystrokes, armor, potions | HUD layer (CPS via `MouseHandler.onButton`) |
| Toggle sprint / sneak | Vanilla `ToggleKeyMapping` toggle check |
| Freelook / Snaplook | `Camera.setup`, `Entity.turn` (local player only); policy-gated |
| Custom crosshair | `replaceElement(CROSSHAIR)` |
| Motion blur | Post pass after world render; off while an Iris shader pack is active |
| Chat tweaks | `ChatComponent.addMessage`, `ChatComponent.clearMessages`, `ChatScreen.mouseClicked` |
| Scoreboard | `replaceElement(SCOREBOARD)`, becomes a movable HUD element |
| Item physics | Dropped item renderer transforms (last, optional) |

### Compatibility

- Only MixinExtras injectors (`@ModifyExpressionValue`, `@WrapOperation`, `@ModifyReturnValue`,
  `@Inject`). No `@Redirect` or `@Overwrite`.
- Nothing touches terrain/chunk rendering, block models or the video settings screen
  (Sodium). Lithium only changes game logic.
- Iris is an optional dependency, used only when installed.
- `./gradlew runClient -Pcompat` runs with Sodium, Lithium, Iris and Mod Menu.

## Launcher

### Main-process services

| Service | Responsibility |
|---|---|
| auth | Microsoft OAuth (auth code + PKCE in system browser, loopback redirect; device code fallback) → Xbox Live → XSTS → Minecraft token → entitlements + profile |
| accounts | Tokens encrypted with Electron `safeStorage`. Not saved if Linux falls back to `basic_text`. |
| versions | Version manifest v2, version JSON, rules, `inheritsFrom` merge |
| downloads | Parallel queue, retries, `.part` files, SHA1 verification, atomic rename, repair |
| java | Mojang Java runtime manifest, picked by the version's `javaVersion` |
| fabric | Fabric meta loader profile; our mod + pinned Fabric API injected via `-Dfabric.addMods` |
| launch | Argument templating, classpath, JVM args, spawn; tokens redacted everywhere |
| logs | Structured log4j2 XML events → filter, search, copy, export |
| crash | Crash report, `hs_err_pid*.log`, last 500 lines, suspected mods |
| profiles / mods | Per-profile instance folders; `fabric.mod.json` scanning and compatibility checks |

### Disk layout

```
%APPDATA%/WaveClient/
  launcher.json, accounts.dat (encrypted)
  shared/{versions,libraries,assets,runtimes}/
  client/                      our mod + managed Fabric API
  instances/<profile>/{profile.json, mods/, config/, saves/, resourcepacks/, logs/, crash-reports/}
```

### Installer

- electron-builder NSIS target produces `WaveClient-Setup-<version>.exe`.
- Per-user install by default, so no admin prompt. Location is `%LOCALAPPDATA%\Programs\Wave Client`.
- Creates Start menu and desktop shortcuts and registers an uninstaller in "Apps & features".
  Uninstalling keeps game data unless the user ticks "Remove game data".
- The mod jar is built first and bundled as an extra resource. The launcher copies it into
  `client/` on first run and after updates.
- Built by GitHub Actions on a Windows runner and attached as a workflow artifact (and to
  releases on tags).
- Unsigned until a code-signing certificate is added, so Windows SmartScreen will warn on
  first run.

### Security

`contextIsolation`, `sandbox`, no `nodeIntegration`, a narrow typed preload API and a strict
CSP. All network, filesystem and process work runs in the main process. The renderer never
sees tokens.

## Order of work

1. Mod skeleton, module system, config saving
2. Fullbright, zoom, FPS/coords HUD
3. HUD editor
4. Mod menu
5. Remaining modules
6. Launcher: auth, downloads, Fabric install, launch
7. Launcher mod manager and profiles
8. Windows installer and CI release build
