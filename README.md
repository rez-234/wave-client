# Wave Client

A Minecraft Java Edition PvP and quality-of-life client: a Fabric mod for Minecraft 1.21.11
plus a desktop launcher that installs on Windows.

Only features allowed on major servers are included. No combat automation, reach, x-ray, ESP
or anything else that gives an unfair advantage. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
for the full design.

| Folder | Contents |
|---|---|
| `mod/` | Fabric client mod (Java 21, Gradle, Fabric Loom, Mojang mappings) |
| `launcher/` | Electron + TypeScript + React launcher (Windows installer comes in step 8) |
| `docs/` | Architecture and decisions |

## Building the mod

Requirements: JDK 21 (for example [Temurin 21](https://adoptium.net/temurin/releases/?version=21)).
Everything else, including Minecraft itself, is downloaded by Gradle on first run.

```sh
cd mod
./gradlew build        # compiles, runs unit tests, writes build/libs/waveclient-<version>.jar
./gradlew test         # unit tests only
./gradlew runClient    # starts Minecraft 1.21.11 with the mod loaded (dev account, offline)
./gradlew runClient -Pcompat   # same, with Sodium, Lithium, Iris and Mod Menu loaded too
./gradlew runClientGameTest    # boots the game, creates a test world and checks every module's
                               # hooks; screenshots land in build/clientgametest/screenshots/
```

On Windows use `gradlew.bat` instead of `./gradlew`.

The first `runClient` downloads Minecraft and its assets, which takes a few minutes.
The dev game directory is `mod/run/`, and the mod's config is written to
`mod/run/config/waveclient/config.json`.

## The launcher

The launcher signs in with a Microsoft account, installs Minecraft 1.21.11, Fabric Loader,
Fabric API and Wave Client, and starts the game. Nothing from Minecraft is bundled: game files,
libraries, assets and Mojang's Java runtime are downloaded from Mojang's servers (and Fabric's
from Fabric's) when you first press Play, checked against their published SHA-1 hashes, and
shared by every profile. Later launches only re-check sizes; **Repair game files** re-hashes
everything.

Requirements: Node.js 22.12 or newer.

```sh
cd launcher
npm install
npm run dev          # the launcher with hot reload (expects mod/build/libs/waveclient-*.jar: run ./gradlew build in mod/ first)
npm test             # unit tests
npm run typecheck
npm run build        # production build into launcher/out/
```

Data lives in `%APPDATA%\WaveClient` on Windows (`~/Library/Application Support/WaveClient` on
macOS, `~/.config/WaveClient` on Linux):

| Path | Contents |
|---|---|
| `shared/versions`, `shared/libraries`, `shared/assets`, `shared/runtimes` | Minecraft, Fabric and Java, shared by all profiles |
| `client/` | Wave Client and Fabric API, loaded with `-Dfabric.addMods` |
| `instances/default/` | The game folder: saves, options, `mods/` for your own mods, logs, crash reports |
| `accounts.dat` | Signed-in accounts, encrypted with the OS keychain |
| `launcher.json` | Launcher settings (no secrets) |
| `logs/launcher.log` | The launcher's own log (never contains tokens) |

### Microsoft sign-in setup

Signing in needs an Azure app registration that Mojang has approved for Minecraft. Until a
build has one, the launcher shows that sign-in isn't set up instead of trying.

1. In the [Azure portal](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade),
   register an app for **personal Microsoft accounts**.
2. Under **Authentication**, add the platform **Mobile and desktop applications** with the
   redirect URI `http://localhost` (any port works), and set **Allow public client flows** to
   **Yes** (needed for "Use a code instead"). No client secret is needed.
3. Ask Mojang to approve the app for Minecraft at <https://aka.ms/mce-reviewappid>. Until they
   do, Microsoft and Xbox sign-in succeed but Minecraft rejects the app ("Invalid app
   registration"); the launcher says so.
4. Build with the app's **Application (client) ID**: `MAIN_VITE_MSA_CLIENT_ID=<id> npm run build`
   (or set `WAVE_MSA_CLIENT_ID=<id>` when running, for development). The ID is not a secret.

### How signing in works

Your browser opens Microsoft's sign-in page; the launcher never sees your password. It receives
a one-time code on `http://localhost` (PKCE), then exchanges it for Xbox Live and Minecraft
tokens and reads your Minecraft profile. If your browser can't reach the launcher, **Use a code
instead** shows a code to enter at microsoft.com/link.

Tokens are encrypted with the OS keychain (Windows DPAPI, macOS Keychain, Linux libsecret or
KWallet) before they are written. On a Linux system without a keychain, accounts are kept for
the session only. The Minecraft token is refreshed before a launch when less than 12 hours of
it are left, so it lasts the whole play session.

## Modules

| Module | Id | On by default | What it does |
|---|---|---|---|
| Fullbright | `fullbright` | No | Lights everything up. Your brightness option is never changed, so turning it off restores your setting. |
| Zoom | `zoom` | Yes | Hold C to zoom 4x. Scroll while zoomed to adjust. Lowers mouse sensitivity while zoomed. Optional cinematic camera. |
| FPS | `fps` | Yes | Frames per second in the top-left corner. |
| Coordinates | `coordinates` | No | Your X, Y and Z position, as block coordinates or with decimals. |
| CPS | `cps` | No | Clicks per second. Counts mouse buttons, or whatever attack and use are bound to. Clicks in menus don't count. |
| Ping | `ping` | No | Your latency as the server reports it (the tab list's number). Hidden in your own world, including when it is open to LAN. |
| Direction | `direction` | No | The way you're facing (North, or N with intercardinals), the axis it points along, and optionally degrees. |
| Clock | `clock` | No | Real time, game time or both. 12 or 24 hour. |
| Keystrokes | `keystrokes` | No | W, A, S, D, mouse buttons with CPS, and jump, lit while pressed. Follows your controls, with short labels for long key names (arrows, keypad). |
| Armor Status | `armor_status` | No | Armor and held item with durability, colored like the durability bar. |
| Potion Effects | `potion_effects` | No | Active effects with level and time left. Hides the vanilla icons. Effects a server hides stay hidden. |
| Toggle Sprint | `toggle_sprint` | No | Press sprint once to keep sprinting; optional toggle sneak. Shows a status line. Never changes your controls. With sprint on Ctrl, Ctrl+Q and Ctrl+middle-click don't toggle it. |
| Freelook | `freelook` | No | Hold Left Alt to look around your character without turning. Blocked on Hypixel. |
| Snaplook | `snaplook` | No | Third person (front or back) while a key is held, like holding F5. Allowed everywhere. |
| Custom Crosshair | `crosshair` | No | Cross, T, circle, square or dot, with gap, thickness, center dot, outline, and the vanilla invert look or a solid color. Shows only when the vanilla crosshair would. The defaults draw the vanilla crosshair. |
| Motion Blur | `motion_blur` | No | Blends recent frames. Only the world is blurred, never the HUD or menus. The trail lasts the same at any frame rate. Off while an Iris shader pack is in use. |
| Item Physics | `item_physics` | No | Dropped items lie flat on the ground (or on water and lava) and tumble as they fall. |
| Scoreboard | `scoreboard` | No | The sidebar as a HUD element you can move and resize, with the red score numbers hidden. |
| Chat | `chat` | No | Timestamps on new messages, chat that stays when you leave a world or server, up to 2000 messages of history, and Ctrl/Cmd-click a message to copy it. |

With an Iris shader pack active, Fullbright also reports full night vision to the pack (setting
`shaderPacks`, on by default). Many packs, Complementary included, treat that as fullbright;
how bright it looks still depends on the pack.

### Mod menu

Open the menu from the **Wave Client** button (the wave icon left of "Options...") in the pause
menu, the **Mods** button in the HUD editor, or Mod Menu's **Configure** button. You can also bind
a key to it under **Settings**.

- The sidebar lists the categories; **Settings** holds the client's own options (keys, the
  pause menu button, the menu font).
- Start typing anywhere to search. Search matches module names, descriptions and setting names.
- Click a card's switch to turn a module on or off, or the card itself to open its settings.
- Every setting has its control on the right. The **↺** button beside a changed setting restores
  its default. **Reset to defaults** (click twice) resets the whole module.
- In the color picker, drag in the square and bars or type a hex code: `#RRGGBB`, or
  `#AARRGGBB` for colors with transparency.
- Click a key binding, then press a key or a mouse button (middle or side) to change it. Escape
  cancels and Backspace clears it. Bindings shared with another Wave Client key turn red.
- **Tab** and **Shift+Tab** move between controls; **Space** or **Enter** uses the focused one,
  and the arrow keys adjust sliders and dropdowns.
- **Esc** closes an open color picker or dropdown, cancels a key binding you're changing,
  clears the search box while you're typing in it, and otherwise closes the menu. Mouse button 4,
  or Backspace when no control is focused, goes back from a settings page.

The menu uses Inter, like the launcher. Change it to the Minecraft font under **Settings**
if you prefer. At GUI scale 1, and at a few very large GUI scales (11, 13, 17...), the
Minecraft font is always used.

### HUD editor

Press **Right Shift** in a world to open the HUD editor (change the key with
`/wave set client hudEditorKey <key>`):

- Drag an element to move it. It snaps to the screen edges, the screen's center lines and other
  elements; hold **Alt** to place it freely.
- Drag the small square in an element's bottom-right corner, or scroll over it, to resize it.
- Click an element, then use the **arrow keys** to nudge it by 1 pixel (Shift: 10). **R** resets it.
- **Reset all** puts every element shown in the editor back to its default position and size.
- Right-click an element to open its settings; **Mods** opens the mod menu.
- **Esc**, **Done** or a tap of **Right Shift** closes the editor; positions are saved immediately.

Positions are stored relative to the nearest screen corner, edge or center, so elements stay put
when you resize the window or change the GUI scale. The default positions don't overlap each
other, a boss bar, the hotbar or a full 15-line sidebar at the automatic GUI scale of 1080p and
720p (text on the left, clock top right, keystrokes and armor bottom right, direction under the
boss bar).

Every module also has a `toggleKey` setting (unbound by default), for example
`/wave set fullbright toggleKey b`. HUD elements are hidden while F3 is open, except the
scoreboard and potion effects when they replace vanilla's (vanilla keeps those under F3); change
that with `/wave set client hideHudWithDebug off`.

### In-game command

`/wave` works in singleplayer and on servers (it runs on the client only):

| Command | What it does |
|---|---|
| `/wave list` | All modules and whether they're on |
| `/wave toggle <module>` | Turn a module on or off |
| `/wave get <module\|client>` | Show settings |
| `/wave set <module\|client> <setting> <value>` | Change a setting, e.g. `/wave set client hudEditorKey rshift` |
| `/wave reset <module\|client>` | Restore defaults |
| `/wave save` / `/wave reload` | Write or re-read the config file |

## Third-party assets

The menu font is [Inter](https://rsms.me/inter/) 4.1 by The Inter Project Authors, licensed under
the SIL Open Font License 1.1 (`mod/src/main/resources/assets/waveclient/font/inter/ofl.txt`).
Wave Client ships the Medium and SemiBold weights, subset to Latin, Greek, Cyrillic and common
symbols; other characters fall back to the Minecraft font.
