import * as crypto from "node:crypto";
import { NodeHtmlMarkdown } from "node-html-markdown";
import { Context, Effect, Layer, Option } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import {
  ConnectorError,
  type DiscoveredItem,
  type ExtractedDocument,
  type SourceConnector,
  type WebCursorData,
} from "./connector-base.js";
import {
  type WebResourceTarget,
  type HttpHeader,
  WebResourcesConfig,
} from "../config/schema.js";
import {
  type RawDocument,
  type ProvenanceRecord,
} from "../domain/provenance.js";
import {
  type SaveCheckpointInput,
  type SyncStatus,
} from "../domain/connector.js";
import { generateDocumentUuid } from "../utils/uuid.js";

/**
 * Computes SHA-256 hex digest for content fingerprinting.
 */
export function sha256Hex(data: string): string {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

const tryParseUrl = Option.liftThrowable(
  (relativeOrAbsolute: string, baseUrl?: string) =>
    new URL(relativeOrAbsolute, baseUrl),
);

const tryParseRegex = Option.liftThrowable(
  (pattern: string) => new RegExp(pattern),
);

/**
 * Resolves a relative or absolute link against a base URL.
 * Returns Option.none() if the URL is invalid.
 */
export function resolveUrl(
  baseUrl: string,
  relativeOrAbsolute: string,
): Option.Option<URL> {
  return tryParseUrl(relativeOrAbsolute, baseUrl);
}

/**
 * Lightweight XML parser for standard sitemap.xml files.
 * Extracts `<url><loc>...</loc><lastmod>...</lastmod></url>` entries.
 */
export function parseSitemapXml(
  xmlText: string,
): ReadonlyArray<{ loc: string; lastmod?: string }> {
  const results: Array<{ loc: string; lastmod?: string }> = [];

  // Match url entries in <urlset>
  const urlRegex = /<url>([\s\S]*?)<\/url>/gi;
  let match: RegExpExecArray | null;

  while ((match = urlRegex.exec(xmlText)) !== null) {
    const block = match[1];
    if (!block) continue;
    const locMatch = block.match(/<loc>\s*(.*?)\s*<\/loc>/i);
    if (locMatch && locMatch[1]) {
      const loc = locMatch[1].trim();
      const lastmodMatch = block.match(/<lastmod>\s*(.*?)\s*<\/lastmod>/i);
      const lastmod =
        lastmodMatch && lastmodMatch[1] ? lastmodMatch[1].trim() : undefined;
      results.push({ loc, lastmod });
    }
  }

  // Also check if it's a sitemapindex (<sitemap><loc>...</loc></sitemap>)
  if (results.length === 0) {
    const sitemapRegex = /<sitemap>([\s\S]*?)<\/sitemap>/gi;
    while ((match = sitemapRegex.exec(xmlText)) !== null) {
      const block = match[1];
      if (!block) continue;
      const locMatch = block.match(/<loc>\s*(.*?)\s*<\/loc>/i);
      if (locMatch && locMatch[1]) {
        const loc = locMatch[1].trim();
        const lastmodMatch = block.match(/<lastmod>\s*(.*?)\s*<\/lastmod>/i);
        const lastmod =
          lastmodMatch && lastmodMatch[1] ? lastmodMatch[1].trim() : undefined;
        results.push({ loc, lastmod });
      }
    }
  }

  return results;
}

/**
 * Decodes common HTML entities.
 */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'");
}

/**
 * Strips script, style, comments, and non-content chrome elements
 * (headers, footers, navs, asides, buttons, forms, svgs, accessibility hidden tags).
 */
export function stripHtmlChrome(html: string): string {
  let text = html;
  text = text.replace(
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    " ",
  );
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ");
  text = text.replace(
    /<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi,
    " ",
  );
  text = text.replace(
    /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi,
    " ",
  );
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(
    /<(header|footer|nav|aside|button|form|svg)\b[^<]*(?:(?!<\/\1>)<[^<]*)*<\/\1>/gi,
    " ",
  );
  text = text.replace(
    /<[^>]+\b(role=["'](?:navigation|banner|contentinfo|search|menu)["']|aria-hidden=["']true["'])[^>]*>.*?<\/[^>]+>/gi,
    " ",
  );
  return text;
}

/**
 * Sanitizes and extracts clean, semantic Markdown from HTML body.
 * Strips script, style, comments, header, footer, nav, aside, buttons, forms, svgs.
 * Preserves Markdown headings (#, ##, ...), lists (- item), code blocks (```),
 * inline code (`code`), blockquotes (> quote), links ([text](url)), tables,
 * and bold/italic emphasis.
 */
export function extractMarkdownFromHtml(
  body: string,
  baseUrl?: string,
): string {
  // 1 & 2. Remove scripts, styles, noscript, iframes, comments, and chrome elements
  let text = stripHtmlChrome(body);

  // 3. Preformatted / Code blocks
  text = text.replace(
    /<pre\b[^>]*><code\b[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
    (_, code) => `\n\n\`\`\`\n${decodeHtmlEntities(code).trim()}\n\`\`\`\n\n`,
  );
  text = text.replace(
    /<pre\b[^>]*>([\s\S]*?)<\/pre>/gi,
    (_, code) => `\n\n\`\`\`\n${decodeHtmlEntities(code).trim()}\n\`\`\`\n\n`,
  );
  text = text.replace(
    /<code\b[^>]*>([\s\S]*?)<\/code>/gi,
    (_, code) => `\`${decodeHtmlEntities(code).trim()}\``,
  );

  // 4. Headings: <h1-6> -> Markdown #
  text = text.replace(
    /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
    (_, level, heading) => {
      const hashes = "#".repeat(Number(level));
      const cleanHeading = heading.replace(/<[^>]+>/g, " ").trim();
      return `\n\n${hashes} ${cleanHeading}\n\n`;
    },
  );

  // 5. Blockquotes
  text = text.replace(
    /<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi,
    (_, quote) => {
      const inner = quote.replace(/<[^>]+>/g, " ").trim();
      const lines = inner
        .split("\n")
        .map((l: string) => l.trim())
        .filter((l: string) => l.length > 0);
      return `\n\n` + lines.map((l: string) => `> ${l}`).join("\n") + `\n\n`;
    },
  );

  // 6. Tables: Basic table conversion to Markdown
  text = text.replace(
    /<table\b[^>]*>([\s\S]*?)<\/table>/gi,
    (_, tableContent) => {
      const rows: string[] = [];
      const trRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
      let trMatch: RegExpExecArray | null;
      let isFirstRow = true;

      while ((trMatch = trRegex.exec(tableContent)) !== null) {
        const rowInner = trMatch[1];
        if (!rowInner) continue;
        const cells: string[] = [];
        const isHeaderRow = /<th\b/i.test(rowInner);
        const cellRegex = /<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
        let cellMatch: RegExpExecArray | null;

        while ((cellMatch = cellRegex.exec(rowInner)) !== null) {
          const rawCell = cellMatch[1];
          if (!rawCell) continue;
          const cellText = rawCell
            .replace(/<[^>]+>/g, " ")
            .trim()
            .replace(/\|/g, "\\|");
          cells.push(cellText);
        }

        if (cells.length > 0) {
          rows.push(`| ${cells.join(" | ")} |`);
          if (isFirstRow && isHeaderRow) {
            rows.push(`| ${cells.map(() => "---").join(" | ")} |`);
          }
        }
        isFirstRow = false;
      }

      return rows.length > 0 ? `\n\n${rows.join("\n")}\n\n` : "";
    },
  );

  // 7. Lists
  text = text.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, item) => {
    const cleanItem = item.replace(/<[^>]+>/g, " ").trim();
    return cleanItem.length > 0 ? `- ${cleanItem}\n` : "";
  });

  // 8. Hyperlinks: <a href="...">text</a>
  text = text.replace(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_, href, anchorText) => {
      const cleanAnchor = anchorText.replace(/<[^>]+>/g, " ").trim();
      if (!cleanAnchor) return "";
      const rawHref = href.trim();
      if (
        !rawHref ||
        rawHref.startsWith("#") ||
        rawHref.startsWith("javascript:") ||
        rawHref.startsWith("mailto:") ||
        rawHref.startsWith("tel:")
      ) {
        return cleanAnchor;
      }
      let resolved = rawHref;
      if (baseUrl) {
        const opt = resolveUrl(baseUrl, rawHref);
        if (Option.isSome(opt)) {
          resolved = opt.value.toString();
        }
      }
      return `[${cleanAnchor}](${resolved})`;
    },
  );

  // 9. Bold and Italic formatting
  text = text.replace(
    /<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi,
    "**$1**",
  );
  text = text.replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, "*$1*");

  // 10. Horizontal rules and line breaks
  text = text.replace(/<hr\s*\/?>/gi, "\n\n---\n\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");

  // 11. Structural conversions to newlines
  text = text.replace(/<\/(p|div|section|article|main)>/gi, "\n\n");

  // 12. Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, " ");

  // 13. Decode common HTML entities
  text = decodeHtmlEntities(text);

  // 14. Normalize whitespace while preserving markdown structure and code blocks
  const lines = text.split("\n");
  let inCodeBlock = false;
  const processedLines: string[] = [];

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      processedLines.push(line.trim());
      continue;
    }
    if (inCodeBlock) {
      processedLines.push(line);
    } else {
      const trimmed = line.trim().replace(/[ \t]+/g, " ");
      processedLines.push(trimmed);
    }
  }

  return processedLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Backward-compatible alias for extractMarkdownFromHtml.
 */
export const extractTextFromHtml = extractMarkdownFromHtml;

/**
 * Converts HTML into Markdown using the `node-html-markdown` package.
 * Pre-cleans layout chrome, headers, footers, navigation, and scripts first.
 */
export function extractMarkdownWithNodeHtmlMarkdown(
  body: string,
  baseUrl?: string,
): string {
  let cleaned = stripHtmlChrome(body);
  if (baseUrl) {
    cleaned = cleaned.replace(
      /<a\b([^>]*?)href=["']([^"']+)["']([^>]*?)>/gi,
      (full, pre, href, post) => {
        const rawHref = href.trim();
        if (
          !rawHref ||
          rawHref.startsWith("#") ||
          rawHref.startsWith("javascript:") ||
          rawHref.startsWith("mailto:") ||
          rawHref.startsWith("tel:")
        ) {
          return full;
        }
        const opt = resolveUrl(baseUrl, rawHref);
        if (Option.isSome(opt)) {
          return `<a${pre}href="${opt.value.toString()}"${post}>`;
        }
        return full;
      },
    );
  }
  const markdown = NodeHtmlMarkdown.translate(cleaned, {
    bulletMarker: "-",
    codeBlockStyle: "fenced",
  });
  return markdown
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Checks whether a URL matches inclusion/exclusion filters.
 */
export function isUrlAllowed(
  url: string,
  includePatterns?: readonly string[],
  excludePatterns?: readonly string[],
): boolean {
  if (excludePatterns && excludePatterns.length > 0) {
    for (const pattern of excludePatterns) {
      if (url.includes(pattern)) return false;
      const regexMatched = tryParseRegex(pattern).pipe(
        Option.filter((re) => re.test(url)),
        Option.isSome,
      );
      if (regexMatched) return false;
    }
  }

  if (includePatterns && includePatterns.length > 0) {
    let matched = false;
    for (const pattern of includePatterns) {
      if (url.includes(pattern)) {
        matched = true;
        break;
      }
      const regexMatched = tryParseRegex(pattern).pipe(
        Option.filter((re) => re.test(url)),
        Option.isSome,
      );
      if (regexMatched) {
        matched = true;
        break;
      }
    }
    return matched;
  }

  return true;
}

export interface ExtractedWebContent {
  readonly title: string;
  readonly extractedText: string;
  readonly canonicalUrl?: string;
  readonly extractedLinks: ReadonlyArray<string>;
}

/**
 * Extracts metadata, canonical URLs, text, and internal links from HTML.
 */
export function extractContent(
  baseUrl: string,
  body: string,
  includePatterns?: readonly string[],
  excludePatterns?: readonly string[],
): ExtractedWebContent {
  // Title
  const titleMatch = body.match(/<title>(.*?)<\/title>/i);
  const title = titleMatch && titleMatch[1] ? titleMatch[1].trim() : "";

  // Canonical URL
  let canonicalUrl: string | undefined = undefined;
  const canonicalMatch =
    body.match(
      /<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i,
    ) ||
    body.match(/<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i);
  if (canonicalMatch && canonicalMatch[1]) {
    canonicalUrl = resolveUrl(baseUrl, canonicalMatch[1].trim()).pipe(
      Option.map((u) => u.toString()),
      Option.getOrUndefined,
    );
  }

  if (!canonicalUrl) {
    const ogMatch =
      body.match(
        /<meta\s+[^>]*property=["']og:url["'][^>]*content=["']([^"']+)["']/i,
      ) ||
      body.match(
        /<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:url["']/i,
      );
    if (ogMatch && ogMatch[1]) {
      canonicalUrl = resolveUrl(baseUrl, ogMatch[1].trim()).pipe(
        Option.map((u) => u.toString()),
        Option.getOrUndefined,
      );
    }
  }

  // Base href if present
  const baseMatch = body.match(/<base\s+[^>]*href\s*=\s*["']([^"']+)["']/i);
  let resolvedBaseUrl = baseUrl;
  if (baseMatch && baseMatch[1]) {
    const baseOpt = resolveUrl(baseUrl, baseMatch[1].trim());
    if (Option.isSome(baseOpt)) {
      resolvedBaseUrl = baseOpt.value.toString();
    }
  }

  // Extracted links
  const linkRegex = /<a\s+[^>]*href\s*=\s*["']([^"']+)["']/gi;
  const extractedLinks: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(body)) !== null) {
    if (match && match[1]) {
      const href = match[1].trim();
      if (
        href &&
        !href.startsWith("#") &&
        !href.startsWith("javascript:") &&
        !href.startsWith("mailto:") &&
        !href.startsWith("tel:")
      ) {
        const validLinkOpt = resolveUrl(resolvedBaseUrl, href).pipe(
          Option.filter(
            (parsed) =>
              (parsed.protocol === "http:" || parsed.protocol === "https:") &&
              !/\.(png|jpg|jpeg|gif|svg|webp|ico|pdf|zip|tar|gz|mp3|mp4|css|js)$/i.test(
                parsed.pathname,
              ) &&
              isUrlAllowed(parsed.toString(), includePatterns, excludePatterns),
          ),
          Option.map((parsed) => parsed.toString()),
        );
        if (Option.isSome(validLinkOpt)) {
          extractedLinks.push(validLinkOpt.value);
        }
      }
    }
  }

  const extractedText = extractMarkdownWithNodeHtmlMarkdown(
    body,
    resolvedBaseUrl,
  );

  return {
    title,
    extractedText,
    canonicalUrl,
    extractedLinks,
  };
}

/**
 * Fetches page content following HTTP 3xx redirects (up to 5 hops).
 * (Adapted from https://github.com/justcoon/golem-web-crawler-effect/blob/main/src/fetcher-agent.ts)
 */
export function fetchPageContent(
  targetUrl: string,
  httpClient: HttpClient.HttpClient,
  customHeaders?: ReadonlyArray<HttpHeader> | Record<string, string>,
): Effect.Effect<
  {
    body: string;
    finalUrl: string;
    status: number;
    etag?: string;
    lastModified?: string;
  },
  ConnectorError
> {
  return Effect.gen(function* () {
    let currentUrl = targetUrl;
    let redirectCount = 0;
    const maxRedirects = 5;
    let status = 0;
    let body = "";
    let finalUrl = targetUrl;
    let etag: string | undefined;
    let lastModified: string | undefined;

    while (true) {
      let request = HttpClientRequest.get(currentUrl).pipe(
        HttpClientRequest.setHeader(
          "Accept",
          "text/html, application/xhtml+xml, text/plain, text/markdown, */*",
        ),
        HttpClientRequest.setHeader("User-Agent", "GolemKnowledgeBot/1.0"),
      );

      if (customHeaders) {
        if (Array.isArray(customHeaders)) {
          for (const header of customHeaders) {
            request = HttpClientRequest.setHeader(
              header.name,
              header.value,
            )(request);
          }
        } else {
          for (const [k, v] of Object.entries(customHeaders)) {
            request = HttpClientRequest.setHeader(k, v)(request);
          }
        }
      }

      const response = yield* HttpClient.execute(request).pipe(
        Effect.provideService(HttpClient.HttpClient, httpClient),
        Effect.mapError(
          (err) =>
            new ConnectorError({
              connectorId: "web",
              message: `Failed to fetch URL ${currentUrl}: ${String(err)}`,
              cause: err,
            }),
        ),
      );

      status = response.status;
      etag = response.headers["etag"];
      lastModified = response.headers["last-modified"];

      if (status >= 300 && status <= 399) {
        if (redirectCount >= maxRedirects) {
          return yield* Effect.fail(
            new ConnectorError({
              connectorId: "web",
              message: `Too many redirects for URL: ${currentUrl}`,
              status,
            }),
          );
        }

        const location = response.headers["location"];
        if (!location) {
          return yield* Effect.fail(
            new ConnectorError({
              connectorId: "web",
              message: `Redirect status ${status} without Location header at ${currentUrl}`,
              status,
            }),
          );
        }

        const nextUrlOpt = resolveUrl(currentUrl, location);
        if (Option.isNone(nextUrlOpt)) {
          return yield* Effect.fail(
            new ConnectorError({
              connectorId: "web",
              message: `Invalid redirect Location header: ${location}`,
              status,
            }),
          );
        }

        currentUrl = nextUrlOpt.value.toString();
        redirectCount++;
        continue;
      }

      if (status < 200 || status >= 300) {
        return yield* Effect.fail(
          new ConnectorError({
            connectorId: "web",
            message: `HTTP GET ${currentUrl} returned status ${status}`,
            status,
          }),
        );
      }

      body = yield* response.text.pipe(
        Effect.mapError(
          (err) =>
            new ConnectorError({
              connectorId: "web",
              message: `Failed to read response body from ${currentUrl}: ${String(err)}`,
              cause: err,
            }),
        ),
      );

      finalUrl = currentUrl;
      break;
    }

    return { body, finalUrl, status, etag, lastModified };
  });
}

/**
 * Web Page / Documentation Source Connector implementation.
 */
export class WebPageConnector implements SourceConnector<
  WebResourceTarget,
  WebCursorData,
  DiscoveredItem
> {
  readonly id: string;
  readonly source = "web";
  private readonly pageCache = new Map<
    string,
    {
      body: string;
      finalUrl: string;
      status: number;
      etag?: string;
      lastModified?: string;
    }
  >();

  constructor(
    readonly target: WebResourceTarget,
    private readonly httpClient: HttpClient.HttpClient,
  ) {
    this.id = `web:${target.name}`;
  }

  connect(): Effect.Effect<void, ConnectorError> {
    const { target, httpClient, id } = this;
    return Effect.gen(function* () {
      const probeUrl = target.baseUrl;
      const request = HttpClientRequest.get(probeUrl).pipe(
        HttpClientRequest.setHeader("User-Agent", "GolemKnowledgeBot/1.0"),
      );

      yield* HttpClient.execute(request).pipe(
        Effect.provideService(HttpClient.HttpClient, httpClient),
        Effect.mapError(
          (err) =>
            new ConnectorError({
              connectorId: id,
              message: `Failed to connect to web baseUrl ${probeUrl}: ${String(err)}`,
              cause: err,
            }),
        ),
      );
    });
  }

  discover(
    cursor: Option.Option<WebCursorData>,
  ): Effect.Effect<ReadonlyArray<DiscoveredItem>, ConnectorError> {
    const { target, httpClient } = this;
    const pageCache = this.pageCache;
    return Effect.gen(function* () {
      const currentCursor = Option.getOrUndefined(cursor);
      const processed = currentCursor?.processedUrls ?? {};

      const discoveredUrls: Array<{ url: string; lastmod?: string }> = [];

      // 1. If sitemapUrl is specified, attempt to fetch and parse it
      if (target.sitemapUrl) {
        const sitemapResult = yield* fetchPageContent(
          target.sitemapUrl,
          httpClient,
          target.headers,
        ).pipe(
          Effect.map((res) => parseSitemapXml(res.body)),
          Effect.catch(() => Effect.succeed([])),
        );

        for (const entry of sitemapResult) {
          if (
            isUrlAllowed(
              entry.loc,
              target.includePatterns,
              target.excludePatterns,
            )
          ) {
            discoveredUrls.push({ url: entry.loc, lastmod: entry.lastmod });
          }
        }
      }

      // 2. If no sitemap or sitemap produced no URLs, crawl starting from seedUrls (or baseUrl)
      if (discoveredUrls.length === 0) {
        const initialSeeds =
          target.seedUrls && target.seedUrls.length > 0
            ? target.seedUrls
            : [target.baseUrl];

        const baseHost = tryParseUrl(target.baseUrl).pipe(
          Option.map((u) => u.hostname),
          Option.getOrElse(() => ""),
        );

        const maxPages = target.maxPages ?? 100;
        const queue: string[] = [...initialSeeds];
        const queuedOrVisited = new Set<string>(initialSeeds);

        while (queue.length > 0 && discoveredUrls.length < maxPages) {
          const currentUrl = queue.shift()!;

          const fetchOpt = yield* Effect.option(
            fetchPageContent(currentUrl, httpClient, target.headers),
          );

          if (Option.isNone(fetchOpt)) continue;
          const pageRes = fetchOpt.value;

          // Cache page content so fetch(item) avoids duplicate HTTP calls
          pageCache.set(pageRes.finalUrl, pageRes);
          pageCache.set(currentUrl, pageRes);

          // If the page matches includePatterns or is one of initial seeds, keep it
          const isSeed =
            initialSeeds.includes(currentUrl) ||
            initialSeeds.includes(pageRes.finalUrl);
          if (
            isUrlAllowed(
              pageRes.finalUrl,
              target.includePatterns,
              target.excludePatterns,
            ) ||
            isSeed
          ) {
            if (!discoveredUrls.some((d) => d.url === pageRes.finalUrl)) {
              discoveredUrls.push({
                url: pageRes.finalUrl,
                lastmod: pageRes.lastModified,
              });
            }
          }

          // Extract links from HTML and follow internal links matching criteria
          const content = extractContent(
            pageRes.finalUrl,
            pageRes.body,
            undefined, // extract all links on the page so intermediate pages can bridge to targets
            target.excludePatterns,
          );

          for (const link of content.extractedLinks) {
            const parsedOpt = tryParseUrl(link).pipe(
              Option.map((parsed) => {
                parsed.hash = "";
                return {
                  hostname: parsed.hostname,
                  normalized: parsed.toString(),
                };
              }),
            );

            if (Option.isSome(parsedOpt)) {
              const { hostname, normalized } = parsedOpt.value;
              if (hostname === baseHost && !queuedOrVisited.has(normalized)) {
                if (
                  isUrlAllowed(
                    normalized,
                    target.includePatterns,
                    target.excludePatterns,
                  ) ||
                  isSeed
                ) {
                  queuedOrVisited.add(normalized);
                  queue.push(normalized);
                }
              }
            }
          }
        }
      }

      // Filter out unchanged items if cursor indicates same lastModified
      const items: DiscoveredItem[] = [];

      for (const item of discoveredUrls) {
        const existing = processed[item.url];
        if (
          existing &&
          item.lastmod &&
          existing.lastModified === item.lastmod
        ) {
          // Unchanged according to lastmod
          continue;
        }

        items.push({
          id: item.url,
          uri: item.url,
          sizeBytes: 0,
          lastModified: item.lastmod ? new Date(item.lastmod) : new Date(),
          metadata: {
            resourceName: target.name,
            expectedLastMod: item.lastmod,
          },
        });
      }

      return items;
    });
  }

  fetch(
    item: DiscoveredItem,
  ): Effect.Effect<ExtractedDocument, ConnectorError> {
    const { target, httpClient } = this;
    const pageCache = this.pageCache;
    return Effect.gen(function* () {
      const cached = pageCache.get(item.uri) ?? pageCache.get(item.id);
      const res =
        cached !== undefined
          ? cached
          : yield* fetchPageContent(item.uri, httpClient, target.headers);

      const content = extractContent(
        res.finalUrl,
        res.body,
        target.includePatterns,
        target.excludePatterns,
      );

      const docUuid = generateDocumentUuid("web", target.name, res.finalUrl);
      const text =
        content.extractedText.length > 0
          ? content.extractedText
          : content.title;
      const sizeBytes = Buffer.byteLength(text, "utf8");

      const doc: RawDocument = {
        id: docUuid,
        title: content.title || res.finalUrl,
        content: text,
        source: "web",
        resourceName: target.name,
        sourceKey: res.finalUrl,
        sizeBytes,
        metadata: {
          url: res.finalUrl,
          originalUrl: item.uri,
          domain: new URL(res.finalUrl).hostname,
          canonicalUrl: content.canonicalUrl,
          httpStatus: res.status,
          etag: res.etag,
          lastModified: res.lastModified,
          contentHash: sha256Hex(text),
        },
        tags: ["web", target.name],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const provenance: ProvenanceRecord = {
        source: "web",
        documentId: docUuid,
        uri: res.finalUrl,
        timestamp: item.lastModified,
        extractor: "WebPageConnector",
        extractionConfidence: 1.0,
      };

      return { document: doc, provenance };
    });
  }

  checkpoint(
    cursor: WebCursorData,
    status: SyncStatus = "IDLE",
    metrics?: Record<string, unknown>,
  ): SaveCheckpointInput {
    return {
      connectorId: this.id,
      cursorData: {
        lastSyncTimestamp: cursor.lastSyncTimestamp,
        processedUrls: cursor.processedUrls,
      },
      status,
      metrics: metrics ?? {},
    };
  }
}

/**
 * Service Tag for Web Connector management.
 */
export class WebConnectorService extends Context.Service<
  WebConnectorService,
  {
    readonly createConnector: (
      resourceName: string,
    ) => Effect.Effect<WebPageConnector, ConnectorError>;
  }
>()("app/connectors/WebConnectorService") {
  static readonly Live = Layer.effect(
    WebConnectorService,
    Effect.gen(function* () {
      const resourcesConfig = yield* WebResourcesConfig;
      const httpClient = yield* HttpClient.HttpClient;

      return {
        createConnector: (resourceName: string) =>
          Effect.gen(function* () {
            const targetOpt = resourcesConfig.getWebResource(resourceName);
            if (Option.isNone(targetOpt)) {
              return yield* Effect.fail(
                new ConnectorError({
                  connectorId: `web:${resourceName}`,
                  message: `Web resource target '${resourceName}' is not configured in golem.yaml`,
                }),
              );
            }
            return new WebPageConnector(targetOpt.value, httpClient);
          }),
      };
    }),
  );
}
