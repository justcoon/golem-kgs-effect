import { createHash } from "node:crypto";

/**
 * Fixed application namespace UUID for Golem KGS document derivation (RFC 4122 compliant).
 */
export const KGS_DOCUMENT_NAMESPACE = "b2e37985-78e7-4402-9954-47b4d1b329fb";

/**
 * Parses a 36-character canonical UUID string into a 16-byte Buffer.
 */
function parseUuidToBytes(uuidStr: string): Buffer {
  const hex = uuidStr.replace(/-/g, "");
  if (hex.length !== 32) {
    throw new Error(`Invalid namespace UUID format: '${uuidStr}'`);
  }
  return Buffer.from(hex, "hex");
}

const NAMESPACE_BYTES = parseUuidToBytes(KGS_DOCUMENT_NAMESPACE);

/**
 * Generates an RFC 4122 version 5 UUID from a source, resource name, and source key.
 *
 * Guaranteed deterministic: identical inputs yield identical UUIDs across processes and runs.
 *
 * @param source - Connector type (e.g. "s3", "git", "filesystem")
 * @param resourceName - Configured resource target identifier (e.g. "main", "legal")
 * @param sourceKey - Unique item path/key within that resource (e.g. "docs/architecture.md")
 * @returns Standard 36-character lowercase UUID string (e.g. "xxxxxxxx-xxxx-5xxx-yxxx-xxxxxxxxxxxx")
 */
export function generateDocumentUuid(
  source: string,
  resourceName: string,
  sourceKey: string,
): string {
  const input = `${source}:${resourceName}:${sourceKey}`;
  const inputBytes = Buffer.from(input, "utf8");

  const hash = createHash("sha1");
  hash.update(NAMESPACE_BYTES);
  hash.update(inputBytes);
  const digest = hash.digest();

  // RFC 4122 Section 4.3: Set version 5 (bits 4-7 of octet 6)
  const byte6 = digest[6] ?? 0;
  digest[6] = (byte6 & 0x0f) | 0x50;
  // RFC 4122 Section 4.3: Set variant (bits 6-7 of octet 8 to 10)
  const byte8 = digest[8] ?? 0;
  digest[8] = (byte8 & 0x3f) | 0x80;

  const hex = digest.subarray(0, 16).toString("hex");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates whether a given string is a canonical RFC 4122 UUID.
 */
export function isValidUuid(id: string): boolean {
  return UUID_REGEX.test(id);
}
