import type { LauncherSettings } from '@shared/ipc'

import { splitJvmArgs } from '../settings'
import {
  expandArguments,
  gameArgumentTemplates,
  jvmArgumentTemplates,
  substitute,
  type ArgumentValues,
  type RuleEnvironment,
  type VersionJson
} from './version'

/** The signed-in player, as the game needs it. */
export interface LaunchAccount {
  name: string
  /** Profile UUID without dashes. */
  uuid: string
  accessToken: string
  xuid: string
}

export interface LaunchInput {
  /** The merged version (Fabric on top of vanilla). */
  version: VersionJson
  env: RuleEnvironment
  java: string
  /** Absolute library jars in classpath order, then the client jar last. */
  classpath: string[]
  gameDir: string
  nativesDir: string
  librariesDir: string
  assetsRoot: string
  assetIndexName: string
  /** The log4j config to pass with the version's logging argument, if any. */
  logConfigPath: string | null
  /** Paths (files or folders) given to Fabric as -Dfabric.addMods. */
  addMods: string[]
  account: LaunchAccount
  settings: LauncherSettings
  launcherName: string
  launcherVersion: string
  clientId: string
}

export interface LaunchCommand {
  java: string
  args: string[]
  cwd: string
  /** Values that must never appear in logs or the UI. */
  secrets: string[]
}

/**
 * Builds the full command line: the version's JVM arguments (with -cp), the log config, our
 * memory flags and Fabric's mod list, the user's extra JVM arguments, the main class, then the
 * game arguments. HotSpot uses the last copy of a repeated flag, so the user's arguments win.
 */
export function buildLaunchCommand(input: LaunchInput): LaunchCommand {
  const { version, env, settings } = input

  if (!version.mainClass) {
    throw new Error(`Version ${version.id} has no main class`)
  }

  const separator = env.os === 'windows' ? ';' : ':'
  const windowed = !settings.fullscreen
  const values: ArgumentValues = {
    natives_directory: input.nativesDir,
    launcher_name: input.launcherName,
    launcher_version: input.launcherVersion,
    classpath: input.classpath.join(separator),
    classpath_separator: separator,
    library_directory: input.librariesDir,
    version_name: version.id,
    version_type: version.type ?? 'release',
    auth_player_name: input.account.name,
    auth_uuid: input.account.uuid,
    auth_access_token: input.account.accessToken,
    auth_xuid: input.account.xuid,
    clientid: input.clientId,
    user_type: 'msa',
    game_directory: input.gameDir,
    assets_root: input.assetsRoot,
    assets_index_name: input.assetIndexName,
    resolution_width: String(settings.width),
    resolution_height: String(settings.height)
  }
  const gameEnv: RuleEnvironment = {
    ...env,
    features: {
      is_demo_user: false,
      has_custom_resolution: windowed,
      has_quick_plays_support: false,
      is_quick_play_singleplayer: false,
      is_quick_play_multiplayer: false,
      is_quick_play_realms: false
    }
  }

  const jvm = expandArguments(jvmArgumentTemplates(version), env, values)

  if (input.logConfigPath && version.logging?.client?.argument) {
    jvm.push(substitute(version.logging.client.argument, { path: input.logConfigPath }))
  }

  jvm.push(`-Xms${Math.min(settings.memoryMb, 1024)}M`, `-Xmx${settings.memoryMb}M`)

  if (input.addMods.length > 0) {
    jvm.push(`-Dfabric.addMods=${input.addMods.join(separator)}`)
  }

  jvm.push(...splitJvmArgs(settings.jvmArgs))

  const game = expandArguments(gameArgumentTemplates(version), gameEnv, values)

  if (settings.fullscreen) {
    game.push('--fullscreen')
  }

  const unresolved = [...jvm, ...game].find((arg) => /\$\{[a-zA-Z0-9_]+\}/.test(arg))

  if (unresolved) {
    throw new Error(`Unknown placeholder in launch arguments: ${unresolved}`)
  }

  return {
    java: input.java,
    args: [...jvm, version.mainClass, ...game],
    cwd: input.gameDir,
    secrets: [input.account.accessToken].filter((secret) => secret.length >= 8)
  }
}

/** Replaces every secret in a piece of text, for logs and error messages. */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text

  for (const secret of secrets) {
    if (secret.length >= 8) {
      out = out.split(secret).join('[redacted]')
    }
  }

  return out
}
