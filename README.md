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
```

On Windows use `gradlew.bat` instead of `./gradlew`.

The first `runClient` downloads Minecraft and its assets, which takes a few minutes.
The dev game directory is `mod/run/`, and the mod's config is written to
`mod/run/config/waveclient/config.json`.

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
