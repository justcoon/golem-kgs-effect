import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Effect, Option, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import {
  extractContent,
  extractMarkdownFromHtml,
  extractMarkdownWithNodeHtmlMarkdown,
  extractTextFromHtml,
  isUrlAllowed,
  parseSitemapXml,
  resolveUrl,
  sha256Hex,
  WebPageConnector,
} from "../src/connectors/web-connector.js";
import { DocumentChunker } from "../src/pipeline/chunker.js";
import {
  WebProcessedUrlEntrySchema,
  WebTaskMetricsSchema,
  WebTaskStateSchema,
  WebTaskStatusResponseSchema,
  type WebTaskStatusResponse,
} from "../src/agents/types.js";
import { WebResourceTargetSchema } from "../src/config/schema.js";

describe("Web Connector & Ingestion Subsystem", () => {
  describe("parseSitemapXml", () => {
    it("should parse standard sitemap.xml with multiple url entries and lastmod dates", () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://learn.golem.cloud/docs/intro</loc>
    <lastmod>2026-09-01T12:00:00Z</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://learn.golem.cloud/docs/quickstart</loc>
    <lastmod>2026-09-02T08:30:00Z</lastmod>
  </url>
  <url>
    <loc>https://learn.golem.cloud/docs/faq</loc>
  </url>
</urlset>`;

      const entries = parseSitemapXml(xml);
      assert.equal(entries.length, 3);
      assert.equal(entries[0]?.loc, "https://learn.golem.cloud/docs/intro");
      assert.equal(entries[0]?.lastmod, "2026-09-01T12:00:00Z");
      assert.equal(
        entries[1]?.loc,
        "https://learn.golem.cloud/docs/quickstart",
      );
      assert.equal(entries[1]?.lastmod, "2026-09-02T08:30:00Z");
      assert.equal(entries[2]?.loc, "https://learn.golem.cloud/docs/faq");
      assert.equal(entries[2]?.lastmod, undefined);
    });

    it("should parse sitemap index with child sitemaps when urlset is not present", () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://example.com/sitemap-docs.xml</loc>
    <lastmod>2026-09-05T00:00:00Z</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://example.com/sitemap-blog.xml</loc>
  </sitemap>
</sitemapindex>`;

      const entries = parseSitemapXml(xml);
      assert.equal(entries.length, 2);
      assert.equal(entries[0]?.loc, "https://example.com/sitemap-docs.xml");
      assert.equal(entries[1]?.loc, "https://example.com/sitemap-blog.xml");
    });

    it("should return empty array for invalid or empty XML", () => {
      assert.deepEqual(parseSitemapXml(""), []);
      assert.deepEqual(
        parseSitemapXml("<html><body>Not a sitemap</body></html>"),
        [],
      );
    });
  });

  describe("extractMarkdownFromHtml / extractTextFromHtml", () => {
    it("should strip script, style, comments, and chrome elements while preserving markdown headings, lists, bold, and text", () => {
      const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Effect Architecture</title>
  <style>body { font-family: sans-serif; }</style>
  <script>console.log("analytics");</script>
</head>
<body>
  <header><nav><a href="/">Home</a></nav></header>
  <!-- Main content section -->
  <main>
    <h1>Introduction to Effect</h1>
    <p>Effect is a powerful <strong>TypeScript</strong> library for robust programming.</p>
    <h2>Core Primitives</h2>
    <ul>
      <li>Effect&lt;Success, Error, Requirements&gt;</li>
      <li>Layer composition</li>
    </ul>
    <p>Visit &quot;Golem Cloud&quot; &amp; learn more&#39;s features &nbsp; today!</p>
  </main>
  <footer><p>&copy; 2026 Golem Cloud</p></footer>
</body>
</html>`;

      const text = extractTextFromHtml(html);

      assert.ok(!text.includes("body { font-family"));
      assert.ok(!text.includes("console.log"));
      assert.ok(!text.includes("Main content section"));
      assert.ok(!text.includes("Home")); // inside <nav>
      assert.ok(!text.includes("&copy; 2026")); // inside <footer>

      assert.ok(text.includes("# Introduction to Effect"));
      assert.ok(text.includes("Effect is a powerful **TypeScript** library"));
      assert.ok(text.includes("## Core Primitives"));
      assert.ok(text.includes("- Effect<Success, Error, Requirements>"));
      assert.ok(
        text.includes('Visit "Golem Cloud" & learn more\'s features today!'),
      );
    });

    it("should format code blocks, inline code, blockquotes, and tables as markdown", () => {
      const html = `
<div>
  <h3>Code Samples</h3>
  <pre><code>const effect = Effect.succeed(42);</code></pre>
  <p>Run it with <code>Effect.runPromise</code>.</p>
  <blockquote>Important note about concurrency.</blockquote>
  <table>
    <tr><th>Feature</th><th>Supported</th></tr>
    <tr><td>Markdown</td><td>Yes</td></tr>
    <tr><td>HTML</td><td>Converted</td></tr>
  </table>
  <hr />
</div>`;

      const md = extractMarkdownFromHtml(html);

      assert.ok(md.includes("### Code Samples"));
      assert.ok(md.includes("```\nconst effect = Effect.succeed(42);\n```"));
      assert.ok(md.includes("`Effect.runPromise`"));
      assert.ok(md.includes("> Important note about concurrency."));
      assert.ok(md.includes("| Feature | Supported |"));
      assert.ok(md.includes("| --- | --- |"));
      assert.ok(md.includes("| Markdown | Yes |"));
      assert.ok(md.includes("---"));
    });

    it("should resolve relative links against baseUrl and convert to markdown links", () => {
      const html = `
<div>
  <h2>Documentation</h2>
  <a href="/docs/guide">Developer Guide</a>
  <a href="https://example.com/api">API Reference</a>
  <a href="#section-top">Jump to Top</a>
  <a href="javascript:void(0)">Action</a>
</div>`;

      const md = extractMarkdownFromHtml(
        html,
        "https://learn.golem.cloud/docs/intro",
      );

      assert.ok(
        md.includes("[Developer Guide](https://learn.golem.cloud/docs/guide)"),
      );
      assert.ok(md.includes("[API Reference](https://example.com/api)"));
      // in-page jump and javascript links should retain anchor text without broken href
      assert.ok(md.includes("Jump to Top"));
      assert.ok(!md.includes("#section-top"));
      assert.ok(md.includes("Action"));
      assert.ok(!md.includes("javascript:"));
    });

    it("should allow DocumentChunker to parse heading breadcrumbs from extracted HTML markdown", () => {
      const html = `
<h1>Main Topic</h1>
<p>Overview of the topic covering essential architecture and durability models in Golem.</p>
<h2>Sub Topic A</h2>
<p>Details about sub topic A explaining state machine replication, retries, and persistence.</p>
<h3>Deep Nested Topic</h3>
<p>Very detailed information about nested topic describing vector search and embeddings.</p>
`;

      const md = extractMarkdownFromHtml(html);
      const chunkResult = DocumentChunker.chunkText("doc-test-1", md, {
        minChunkSize: 20,
      });

      assert.ok(chunkResult.chunks.length > 0);
      const chunkWithBreadcrumb = chunkResult.chunks.find(
        (c) =>
          typeof c.metadata.headerPath === "string" &&
          c.metadata.headerPath.includes("Main Topic > Sub Topic A"),
      );
      assert.ok(chunkWithBreadcrumb, "Expected chunk with breadcrumb trail");
      assert.equal(
        chunkWithBreadcrumb?.metadata.heading,
        chunkWithBreadcrumb?.metadata.headerPath,
      );
    });
  });

  describe("extractMarkdownWithNodeHtmlMarkdown (node-html-markdown)", () => {
    it("should strip chrome elements and convert HTML to markdown via node-html-markdown", () => {
      const html = `
<header><nav><a href="/">Home</a></nav></header>
<main>
  <h1>Getting Started with Golem</h1>
  <p>Learn how to build <strong>durable agents</strong> using <em>Effect</em>.</p>
  <pre><code>const program = Effect.sync(() => "hello");</code></pre>
  <ul>
    <li>Fast</li>
    <li>Durable</li>
  </ul>
  <a href="/docs/guide">Documentation Guide</a>
</main>
<footer><p>&copy; 2026 Golem Cloud</p></footer>
`;

      const md = extractMarkdownWithNodeHtmlMarkdown(
        html,
        "https://learn.golem.cloud/docs/intro",
      );

      assert.ok(!md.includes("Home")); // nav stripped
      assert.ok(!md.includes("&copy; 2026")); // footer stripped
      assert.ok(md.includes("# Getting Started with Golem"));
      assert.ok(md.includes("**durable agents**"));
      assert.ok(md.includes("*Effect*") || md.includes("_Effect_"));
      assert.ok(md.includes("- Fast"));
      assert.ok(md.includes("- Durable"));
      assert.ok(
        md.includes(
          "[Documentation Guide](https://learn.golem.cloud/docs/guide)",
        ),
      );
    });
  });

  describe("extractContent & link resolution", () => {
    it("should extract title, canonical URL, and valid page links", () => {
      const html = `
<html>
<head>
  <title>Golem Overview</title>
  <link rel="canonical" href="/docs/canonical-overview" />
</head>
<body>
  <h1>Golem Cloud</h1>
  <p>Serverless durable computing platform.</p>
  <a href="/docs/agents">Durable Agents</a>
  <a href="https://learn.golem.cloud/docs/rpc">RPC Guide</a>
  <a href="https://external.com/asset.png">Image</a>
  <a href="javascript:void(0)">Do Nothing</a>
  <a href="mailto:support@golem.cloud">Email</a>
</body>
</html>`;

      const content = extractContent(
        "https://learn.golem.cloud/docs/intro",
        html,
      );

      assert.equal(content.title, "Golem Overview");
      assert.equal(
        content.canonicalUrl,
        "https://learn.golem.cloud/docs/canonical-overview",
      );
      assert.ok(
        content.extractedText.includes("Serverless durable computing platform"),
      );

      // Links: should include relative resolved and external valid http links, exclude .png, javascript, mailto
      assert.ok(
        content.extractedLinks.includes(
          "https://learn.golem.cloud/docs/agents",
        ),
      );
      assert.ok(
        content.extractedLinks.includes("https://learn.golem.cloud/docs/rpc"),
      );
      assert.ok(!content.extractedLinks.some((l) => l.endsWith(".png")));
      assert.ok(
        !content.extractedLinks.some((l) => l.startsWith("javascript:")),
      );
      assert.ok(!content.extractedLinks.some((l) => l.startsWith("mailto:")));
    });

    it("should extract OpenGraph og:url when canonical link tag is missing", () => {
      const html = `
<html>
<head>
  <title>Article</title>
  <meta property="og:url" content="https://example.com/articles/durable-state" />
</head>
<body><p>Article body</p></body>
</html>`;

      const content = extractContent("https://example.com/current", html);
      assert.equal(
        content.canonicalUrl,
        "https://example.com/articles/durable-state",
      );
    });
  });

  describe("isUrlAllowed filtering", () => {
    it("should filter based on includePatterns and excludePatterns", () => {
      const includes = ["/docs/", "/guides/"];
      const excludes = ["/tags/", "/search", "\\.draft$"];

      assert.ok(
        isUrlAllowed("https://example.com/docs/intro", includes, excludes),
      );
      assert.ok(
        isUrlAllowed("https://example.com/guides/setup", includes, excludes),
      );

      // Excluded by pattern
      assert.ok(
        !isUrlAllowed(
          "https://example.com/docs/tags/cloud",
          includes,
          excludes,
        ),
      );
      assert.ok(
        !isUrlAllowed(
          "https://example.com/docs/search?q=test",
          includes,
          excludes,
        ),
      );
      assert.ok(
        !isUrlAllowed(
          "https://example.com/docs/post.draft",
          includes,
          excludes,
        ),
      );

      // Not included
      assert.ok(
        !isUrlAllowed("https://example.com/blog/news", includes, excludes),
      );
    });
  });

  describe("Utilities", () => {
    it("should compute valid SHA-256 hex digest", () => {
      const hash = sha256Hex("hello world");
      assert.equal(
        hash,
        "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
      );
    });

    it("should resolve valid URLs and reject garbage", () => {
      const u1 = resolveUrl("https://example.com/path/", "subpage");
      assert.ok(Option.isSome(u1));
      assert.equal(u1.value.toString(), "https://example.com/path/subpage");

      const u2 = resolveUrl("https://example.com/path/", "../other");
      assert.ok(Option.isSome(u2));
      assert.equal(u2.value.toString(), "https://example.com/other");

      assert.ok(Option.isNone(resolveUrl("invalid-base", "relative")));
    });
  });

  describe("Web Ingestion Configuration & Agent Schemas", () => {
    it("should decode valid WebResourceTargetSchema", () => {
      const raw = {
        name: "golem-docs",
        baseUrl: "https://learn.golem.cloud",
        sitemapUrl: "https://learn.golem.cloud/sitemap.xml",
        includePatterns: ["/docs/"],
        excludePatterns: ["/assets/"],
        headers: [{ name: "User-Agent", value: "TestBot/1.0" }],
      };

      const decoded = Schema.decodeUnknownSync(WebResourceTargetSchema)(raw);
      assert.equal(decoded.name, "golem-docs");
      assert.equal(decoded.baseUrl, "https://learn.golem.cloud");
      assert.equal(decoded.sitemapUrl, "https://learn.golem.cloud/sitemap.xml");
      assert.deepEqual(decoded.includePatterns, ["/docs/"]);
      assert.deepEqual(decoded.headers, [
        { name: "User-Agent", value: "TestBot/1.0" },
      ]);
    });

    it("should decode WebTaskStatusResponseSchema", () => {
      const raw = {
        resourceName: "golem-docs",
        status: "COMPLETED",
        lastSyncTimestamp: "2026-09-09T18:00:00.000Z",
        processedUrls: [
          {
            url: "https://learn.golem.cloud/docs/intro",
            etag: '"abc-123"',
            lastModified: "2026-09-01T00:00:00Z",
            contentHash: "sha256:hash1",
          },
        ],
        cursor: null,
        metrics: {
          totalDiscovered: 15,
          totalSynced: 15,
          totalFailed: 0,
          lastDurationMs: 420,
        },
        errorMessage: null,
      };

      const decoded: WebTaskStatusResponse = Schema.decodeUnknownSync(
        WebTaskStatusResponseSchema,
      )(raw);
      assert.equal(decoded.resourceName, "golem-docs");
      assert.equal(decoded.status, "COMPLETED");
      assert.equal(decoded.processedUrls.length, 1);
      assert.equal(decoded.metrics.totalSynced, 15);
    });

    it("should decode WebTaskStateSchema", () => {
      const raw = {
        resourceName: "effect-specs",
        status: "IDLE",
        lastSyncTimestamp: null,
        processedUrls: {},
        cursor: null,
        metrics: {
          totalDiscovered: 0,
          totalSynced: 0,
          totalFailed: 0,
          lastDurationMs: 0,
        },
        errorMessage: null,
      };

      const decoded = Schema.decodeUnknownSync(WebTaskStateSchema)(raw);
      assert.equal(decoded.resourceName, "effect-specs");
      assert.equal(decoded.status, "IDLE");
      assert.deepEqual(decoded.processedUrls, {});
    });

    it("should decode WebProcessedUrlEntrySchema and WebTaskMetricsSchema", () => {
      const urlEntry = {
        url: "https://learn.golem.cloud/docs",
        contentHash: "abc123hash",
        etag: '"etag-1"',
        lastModified: "Wed, 21 Oct 2025 07:28:00 GMT",
        syncedAt: "2026-09-09T18:00:00.000Z",
      };
      const decodedEntry = Schema.decodeUnknownSync(WebProcessedUrlEntrySchema)(
        urlEntry,
      );
      assert.equal(decodedEntry.url, "https://learn.golem.cloud/docs");
      assert.equal(decodedEntry.contentHash, "abc123hash");

      const metrics = {
        totalDiscovered: 42,
        totalSynced: 40,
        totalFailed: 2,
        lastDurationMs: 1250,
      };
      const decodedMetrics =
        Schema.decodeUnknownSync(WebTaskMetricsSchema)(metrics);
      assert.equal(decodedMetrics.totalDiscovered, 42);
      assert.equal(decodedMetrics.totalSynced, 40);
      assert.equal(decodedMetrics.totalFailed, 2);
    });

    it("should recursively crawl internal links from seedUrls matching includePatterns", async () => {
      const mockHtml: Record<string, string> = {
        "https://learn.golem.cloud": `
          <html>
            <body>
              <h1>Golem Cloud</h1>
              <a href="/v1.5/develop">Develop</a>
              <a href="/v1.5/quickstart">Quickstart</a>
              <a href="/blog/ignored">Blog</a>
              <a href="https://external.com/docs">External</a>
            </body>
          </html>
        `,
        "https://learn.golem.cloud/v1.5/develop": `
          <html>
            <head><title>Develop on Golem</title></head>
            <body>
              <h1>Develop on Golem</h1>
              <a href="/v1.5/develop/setup">Setup</a>
              <a href="/v1.5/develop/http">HTTP</a>
            </body>
          </html>
        `,
        "https://learn.golem.cloud/v1.5/quickstart": `
          <html><body><h1>Quickstart</h1></body></html>
        `,
        "https://learn.golem.cloud/v1.5/develop/setup": `
          <html><body><h1>Setup</h1></body></html>
        `,
        "https://learn.golem.cloud/v1.5/develop/http": `
          <html><body><h1>HTTP Endpoints</h1></body></html>
        `,
      };

      const mockClient = HttpClient.make((req) => {
        const body = mockHtml[req.url] ?? "<html><body>Not Found</body></html>";
        const status = mockHtml[req.url] ? 200 : 404;
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            req,
            new Response(body, {
              status,
              headers: { "content-type": "text/html" },
            }),
          ),
        );
      });

      const connector = new WebPageConnector(
        {
          name: "golem-docs",
          baseUrl: "https://learn.golem.cloud",
          seedUrls: ["https://learn.golem.cloud"],
          includePatterns: ["/v1.5/"],
        },
        mockClient,
      );

      const items = await Effect.runPromise(connector.discover(Option.none()));

      const urls = items.map((it) => it.uri);
      assert.ok(urls.includes("https://learn.golem.cloud"));
      assert.ok(urls.includes("https://learn.golem.cloud/v1.5/develop"));
      assert.ok(urls.includes("https://learn.golem.cloud/v1.5/quickstart"));
      assert.ok(urls.includes("https://learn.golem.cloud/v1.5/develop/setup"));
      assert.ok(urls.includes("https://learn.golem.cloud/v1.5/develop/http"));
      assert.ok(!urls.includes("https://learn.golem.cloud/blog/ignored"));
      assert.ok(!urls.includes("https://external.com/docs"));
      assert.equal(items.length, 5);

      // Verify cached fetch returns content without throwing
      const doc = await Effect.runPromise(connector.fetch(items[1]!));
      assert.equal(doc.document.title, "Develop on Golem");
      assert.ok(doc.document.content.includes("Develop on Golem"));
    });

    it("should use WebPageConnector.make with Effect Cache to deduplicate fetch HTTP requests", async () => {
      let httpRequestsCount = 0;
      const testHtml =
        "<html><head><title>Cached Page</title></head><body><p>Hello Effect Cache</p></body></html>";

      const countingClient = HttpClient.make((req) => {
        httpRequestsCount++;
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            req,
            new Response(testHtml, {
              status: 200,
              headers: { "content-type": "text/html" },
            }),
          ),
        );
      });

      const connector = await Effect.runPromise(
        WebPageConnector.make(
          {
            name: "test-cache",
            baseUrl: "https://example.com",
            seedUrls: ["https://example.com"],
          },
          countingClient,
        ),
      );

      const item = {
        id: "https://example.com",
        uri: "https://example.com",
        sizeBytes: 0,
        lastModified: new Date(),
        metadata: { resourceName: "test-cache" },
      };

      // First fetch: should trigger 1 HTTP request via Cache lookup
      const doc1 = await Effect.runPromise(connector.fetch(item));
      assert.equal(doc1.document.title, "Cached Page");
      assert.equal(httpRequestsCount, 1);

      // Second fetch: should hit Effect Cache without issuing another HTTP request
      const doc2 = await Effect.runPromise(connector.fetch(item));
      assert.equal(doc2.document.title, "Cached Page");
      assert.equal(httpRequestsCount, 1);

      // Third fetch on another URI: triggers a second HTTP request
      const item2 = {
        ...item,
        id: "https://example.com/other",
        uri: "https://example.com/other",
      };
      const doc3 = await Effect.runPromise(connector.fetch(item2));
      assert.equal(doc3.document.title, "Cached Page");
      assert.equal(httpRequestsCount, 2);

      // Re-fetch item2: should hit cache
      await Effect.runPromise(connector.fetch(item2));
      assert.equal(httpRequestsCount, 2);
    });
  });
});
