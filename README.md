# Wave Client

A Minecraft Java Edition PvP and quality-of-life client: a Fabric mod for Minecraft 1.21.11
plus a desktop launcher that installs on Windows.

Only features allowed on major servers are included. No combat automation, reach, x-ray, ESP
or anything else that gives an unfair advantage. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
for the full design.

| Folder | Contents |
|---|---|
| `mod/` | Fabric client mod (Java 21, Gradle, Fabric Loom, Mojang mappings) |
| `launcher/` | Electron + TypeScript launcher and Windows installer (coming in steps 6 to 8) |
| `docs/` | Architecture and decisions |

## Building the mod

Requirements: JDK 21 (for example [Temurin 21](https://adoptium.net/temurin/releases/?version=21)).
Everything else, including Minecraft itself, is downloaded by Gradle on first run.

```sh
cd mod
./gradlew build        # compiles, runs unit tests, writes build/libs/waveclient-<version>.jar
./gradlew test         # unit tests only
./gradlew runClient    # starts Minecraft 1.21.11 with the mod loaded (dev account, offline)
./gradlew runClient -Pcompat   # same, with Sodium, Lithium and Iris loaded too
```

On Windows use `gradlew.bat` instead of `./gradlew`.

The first `runClient` downloads Minecraft and its assets, which takes a few minutes.
The dev game directory is `mod/run/`, and the mod's config is written to
`mod/run/config/waveclient/config.json`.

## Modules

| Module | Id | On by default | What it does |
|---|---|---|---|
| Fullbright | `fullbright` | No | Lights everything up. Your brightness option is never changed, so turning it off restores your setting. |
| Zoom | `zoom` | Yes | Hold C to zoom 4x. Scroll while zoomed to adjust. Lowers mouse sensitivity while zoomed. Optional cinematic camera. |
| FPS | `fps` | Yes | Frames per second in the top-left corner. |
| Coordinates | `coordinates` | No | Your X, Y and Z position, as block coordinates or with decimals. |

With an Iris shader pack active, Fullbright also reports full night vision to the pack (setting
`shaderPacks`, on by default). Many packs, Complementary included, treat that as fullbright;
how bright it looks still depends on the pack.

Every module also has a `toggleKey` setting (unbound by default), for example
`/wave set fullbright toggleKey b`. HUD elements are hidden while F3 is open; change that
with `/wave set client hideHudWithDebug off`.

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
