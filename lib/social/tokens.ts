/**
 * Encrypting the one secret this system holds.
 *
 * A long-lived Page token is a standing grant to post as the shop. It is not a
 * password anybody can rotate by forgetting it — it sits in the database until
 * somebody revokes it in Meta's settings, so a `pg_dump` left in a backup folder
 * is a working copy of the shop's voice. Every other value in this database is
 * competitive information; this one is an authority.
 *
 * So it is encrypted at rest with a key that lives outside the database, and
 * `token_cipher` is the only column that ever holds it.
 *
 * AES-256-GCM rather than CBC because it authenticates: a ciphertext somebody
 * edited fails to decrypt instead of returning plausible bytes. That matters
 * more here than confidentiality alone — a token silently mangled into a
 * different token is a request that fails at Meta with an unreadable error, and
 * the tampering is what you want to hear about.
 *
 * **Nothing in this file ever puts a token or a key into a message.** An error
 * is written to a log, a log is pasted into a chat, and the point of encrypting
 * it was that it never travels. The errors here say what is wrong and what to do
 * about it, and name no value.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/** 96 bits, the size GCM is specified for. */
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32

/**
 * The key, read per call rather than at module load.
 *
 * Same shape as the boot-time asserts in lib/db.ts and lib/ai/generate.ts, with
 * one deliberate difference: those throw at import and so refuse to start the
 * app at all. This one throws where it is used, because the rest of the system
 * has to keep working on a machine that has never connected a Facebook page —
 * an unset key must break publishing and nothing else.
 */
function key(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      'APP_ENCRYPTION_KEY is not set, so access tokens cannot be stored or read.\n' +
        'Generate one and put it in .env:  ' +
        'node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'base64\'))"',
    )
  }
  const k = Buffer.from(raw, 'base64')
  if (k.length !== KEY_BYTES) {
    // The length is named, the value is not. A key printed into an error is a
    // key in a log file, and that is the failure this module exists to prevent.
    throw new Error(
      `APP_ENCRYPTION_KEY decodes to ${k.length} bytes; AES-256 needs exactly ${KEY_BYTES}.\n` +
        'It must be 32 random bytes, base64-encoded:  ' +
        'node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'base64\'))"',
    )
  }
  return k
}

/**
 * `iv || tag || ciphertext`, base64.
 *
 * One string, so the column is one column. A fresh random IV every call, which
 * is what makes GCM safe to reuse a key with — the same token encrypted twice
 * gives two different ciphertexts, and a reused IV with a reused key is the one
 * mistake that breaks it completely.
 */
export function encrypt(plain: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')
}

/**
 * Throws on anything that is not exactly what `encrypt` wrote — a truncated
 * string, a flipped byte, a value encrypted under a different key. That is the
 * property being bought: there is no partial success, and no garbage returned
 * as if it were a token.
 */
export function decrypt(stored: string): string {
  const buf = Buffer.from(stored, 'base64')
  if (buf.length <= IV_BYTES + TAG_BYTES) {
    throw new Error('Stored access token is not readable: the value is too short to be a ciphertext.')
  }
  const decipher = createDecipheriv('aes-256-gcm', key(), buf.subarray(0, IV_BYTES))
  decipher.setAuthTag(buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES))
  try {
    return decipher.update(buf.subarray(IV_BYTES + TAG_BYTES)).toString('utf8') + decipher.final('utf8')
  } catch {
    // Node's own message here is "Unsupported state or unable to authenticate
    // data", which tells the person nothing they can act on. Replaced, and
    // still naming no value: the two realistic causes are a rotated key and a
    // row somebody edited by hand.
    throw new Error(
      'Stored access token failed to decrypt. Either APP_ENCRYPTION_KEY has changed since it was ' +
        'saved, or the stored value was altered. Reconnect the account to store a fresh token.',
    )
  }
}
