import { safeStorage } from 'electron'

import type { SecretBox } from '../accounts/store'

/**
 * safeStorage backed by the OS: DPAPI on Windows, Keychain on macOS, libsecret or KWallet on
 * Linux. On Linux without a keyring Electron falls back to a hard-coded key ("basic_text"), which
 * is not secure, so that counts as unavailable.
 */
export const electronSecretBox: SecretBox = {
  available(): boolean {
    if (!safeStorage.isEncryptionAvailable()) {
      return false
    }

    return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'
  },
  encrypt(plainText: string): Buffer {
    return safeStorage.encryptString(plainText)
  },
  decrypt(encrypted: Buffer): string {
    return safeStorage.decryptString(encrypted)
  }
}
