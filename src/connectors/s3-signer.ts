import * as crypto from "node:crypto";

export interface S3SignOptions {
  readonly method: string;
  readonly url: URL;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly payloadHash?: string;
  readonly now?: Date;
}

export interface ParsedS3Object {
  readonly key: string;
  readonly lastModified: Date;
  readonly etag: string;
  readonly size: number;
}

export interface ParsedListBucketResult {
  readonly bucket: string;
  readonly prefix: string;
  readonly isTruncated: boolean;
  readonly nextContinuationToken?: string;
  readonly objects: ReadonlyArray<ParsedS3Object>;
}

export function sha256Hex(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data).digest();
}

/**
 * Builds an S3 path-style URL given an endpoint, bucket, and optional key or query parameters.
 */
export function buildS3Url(
  endpoint: string,
  bucket: string,
  pathOrKey = "",
  queryParams?: Record<string, string>,
): URL {
  // Normalize endpoint: remove trailing slash
  const normalizedEndpoint = endpoint.replace(/\/+$/, "");
  const normalizedKey = pathOrKey.replace(/^\/+/, "");

  const fullPath =
    normalizedKey.length > 0
      ? `${normalizedEndpoint}/${bucket}/${normalizedKey}`
      : `${normalizedEndpoint}/${bucket}`;

  const url = new URL(fullPath);
  if (queryParams) {
    for (const [k, v] of Object.entries(queryParams)) {
      if (v !== undefined && v !== "") {
        url.searchParams.set(k, v);
      }
    }
  }
  return url;
}

/**
 * Generates AWS Signature Version 4 (SigV4) authorization headers for S3 REST API calls.
 */
export function signS3Request(opts: S3SignOptions): Record<string, string> {
  const now = opts.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.substring(0, 8);
  const payloadHash = opts.payloadHash ?? sha256Hex("");

  const host = opts.url.host;
  const canonicalUri = opts.url.pathname.length > 0 ? opts.url.pathname : "/";

  // Sort query params alphabetically
  const searchParams = Array.from(opts.url.searchParams.entries());
  searchParams.sort(([k1], [k2]) => k1.localeCompare(k2));
  const canonicalQueryString = searchParams
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    opts.method.toUpperCase(),
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${opts.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmacSha256("AWS4" + opts.secretAccessKey, dateStamp);
  const kRegion = hmacSha256(kDate, opts.region);
  const kService = hmacSha256(kRegion, "s3");
  const kSigning = hmacSha256(kService, "aws4_request");
  const signature = crypto
    .createHmac("sha256", kSigning)
    .update(stringToSign)
    .digest("hex");

  const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    Host: host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    Authorization: authorizationHeader,
  };
}

/**
 * Lightweight XML parser for S3 ListObjectsV2 responses.
 */
export function parseListBucketResultXml(
  xmlText: string,
): ParsedListBucketResult {
  const bucket = xmlText.match(/<Name>(.*?)<\/Name>/)?.[1] ?? "";
  const prefix = xmlText.match(/<Prefix>(.*?)<\/Prefix>/)?.[1] ?? "";
  const isTruncatedStr =
    xmlText.match(/<IsTruncated>(.*?)<\/IsTruncated>/)?.[1] ?? "false";
  const isTruncated = isTruncatedStr.toLowerCase() === "true";
  const nextContinuationToken = xmlText.match(
    /<NextContinuationToken>(.*?)<\/NextContinuationToken>/,
  )?.[1];

  const objects: ParsedS3Object[] = [];
  const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/g;
  let match: RegExpExecArray | null;

  while ((match = contentsRegex.exec(xmlText)) !== null) {
    const block = match[1];
    if (!block) {
      continue;
    }
    const key = block.match(/<Key>(.*?)<\/Key>/)?.[1] ?? "";
    const lastModifiedStr =
      block.match(/<LastModified>(.*?)<\/LastModified>/)?.[1] ?? "";
    const etagRaw = block.match(/<ETag>(.*?)<\/ETag>/)?.[1] ?? "";
    const etag = etagRaw.replace(/&quot;/g, "").replace(/"/g, "");
    const sizeStr = block.match(/<Size>(.*?)<\/Size>/)?.[1] ?? "0";
    const size = parseInt(sizeStr, 10);

    if (key.length > 0) {
      objects.push({
        key,
        lastModified:
          lastModifiedStr.length > 0 ? new Date(lastModifiedStr) : new Date(),
        etag,
        size: Number.isNaN(size) ? 0 : size,
      });
    }
  }

  return {
    bucket,
    prefix,
    isTruncated,
    nextContinuationToken,
    objects,
  };
}
