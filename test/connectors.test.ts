import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Effect, Option, Redacted, Schema } from "effect";
import {
  ResourcesConfigSchema,
  S3ResourceTargetSchema,
} from "../src/config/schema.js";
import {
  buildS3Url,
  parseListBucketResultXml,
  sha256Hex,
  signS3Request,
} from "../src/connectors/s3-signer.js";
import { S3ConnectorService } from "../src/connectors/s3-connector.js";
import { type S3CursorData } from "../src/connectors/connector-base.js";

describe("Phase 3 Connectors & S3 Ingestion", () => {
  describe("Dynamic Multi-Resource Configuration", () => {
    it("should decode dynamic multi-resource S3 configuration under resources.s3", () => {
      const raw = {
        resources: Redacted.make({
          s3: {
            main: {
              endpoint: "http://localhost:9000",
              region: "us-east-1",
              bucket: "golem-documents",
              accessKeyId: "rustfsadmin",
              secretAccessKey: "rustfsadmin123",
            },
            legal: {
              endpoint: "http://localhost:9000",
              region: "us-east-1",
              bucket: "legal-docs",
              accessKeyId: "rustfsadmin",
              secretAccessKey: "rustfsadmin123",
            },
            technical: {
              endpoint: "http://localhost:9000",
              region: "us-east-1",
              bucket: "technical-docs",
              accessKeyId: "rustfsadmin",
              secretAccessKey: "rustfsadmin123",
            },
          },
        }),
      };

      const parsed = Schema.decodeUnknownSync(ResourcesConfigSchema)(raw);
      assert.ok(Redacted.isRedacted(parsed.resources));

      const inner = Redacted.value(parsed.resources);
      const resourceNames = Object.keys(inner.s3);

      assert.deepEqual(resourceNames, ["main", "legal", "technical"]);
      assert.equal(inner.s3.main.bucket, "golem-documents");
      assert.equal(inner.s3.legal.bucket, "legal-docs");
      assert.equal(inner.s3.technical.bucket, "technical-docs");
    });

    it("should validate a single S3ResourceTarget", () => {
      const target = Schema.decodeUnknownSync(S3ResourceTargetSchema)({
        endpoint: "https://s3.us-west-2.amazonaws.com",
        region: "us-west-2",
        bucket: "enterprise-archive",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      });

      assert.equal(target.region, "us-west-2");
      assert.equal(target.bucket, "enterprise-archive");
    });
  });

  describe("S3 SigV4 Signer & URL Builder", () => {
    it("should build path-style S3 URLs with query parameters correctly", () => {
      const url = buildS3Url(
        "http://localhost:9000/",
        "golem-documents",
        "docs/arch.md",
        { "list-type": "2", prefix: "docs/" },
      );

      assert.equal(
        url.toString(),
        "http://localhost:9000/golem-documents/docs/arch.md?list-type=2&prefix=docs%2F",
      );
    });

    it("should calculate deterministic AWS SigV4 authorization headers", () => {
      const fixedDate = new Date("2026-09-06T12:00:00.000Z");
      const url = new URL(
        "http://localhost:9000/golem-documents?list-type=2&max-keys=10",
      );

      const headers = signS3Request({
        method: "GET",
        url,
        region: "us-east-1",
        accessKeyId: "rustfsadmin",
        secretAccessKey: "rustfsadmin123",
        now: fixedDate,
      });

      assert.equal(headers.Host, "localhost:9000");
      assert.equal(headers["x-amz-date"], "20260906T120000Z");
      assert.equal(
        headers["x-amz-content-sha256"],
        sha256Hex(""), // empty payload hash
      );
      assert.ok(
        headers.Authorization.startsWith(
          "AWS4-HMAC-SHA256 Credential=rustfsadmin/20260906/us-east-1/s3/aws4_request",
        ),
      );
      assert.ok(
        headers.Authorization.includes(
          "SignedHeaders=host;x-amz-content-sha256;x-amz-date",
        ),
      );
      assert.ok(headers.Authorization.includes("Signature="));
    });
  });

  describe("S3 XML Response Parser", () => {
    it("should parse S3 ListObjectsV2 XML response with objects and pagination", () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>golem-documents</Name>
  <Prefix>docs/</Prefix>
  <KeyCount>2</KeyCount>
  <MaxKeys>1000</MaxKeys>
  <IsTruncated>true</IsTruncated>
  <NextContinuationToken>token_abc123</NextContinuationToken>
  <Contents>
    <Key>docs/architecture.md</Key>
    <LastModified>2026-09-06T10:30:00.000Z</LastModified>
    <ETag>&quot;34a41d8cd98f00b204e9800998ecf842&quot;</ETag>
    <Size>8192</Size>
  </Contents>
  <Contents>
    <Key>docs/specification.txt</Key>
    <LastModified>2026-09-06T11:00:00.000Z</LastModified>
    <ETag>"7b9f8d1c2e3a"</ETag>
    <Size>2048</Size>
  </Contents>
</ListBucketResult>`;

      const parsed = parseListBucketResultXml(xml);

      assert.equal(parsed.bucket, "golem-documents");
      assert.equal(parsed.prefix, "docs/");
      assert.equal(parsed.isTruncated, true);
      assert.equal(parsed.nextContinuationToken, "token_abc123");
      assert.equal(parsed.objects.length, 2);

      const [first, second] = parsed.objects;
      assert.equal(first.key, "docs/architecture.md");
      assert.equal(first.etag, "34a41d8cd98f00b204e9800998ecf842");
      assert.equal(first.size, 8192);
      assert.equal(
        first.lastModified.toISOString(),
        "2026-09-06T10:30:00.000Z",
      );

      assert.equal(second.key, "docs/specification.txt");
      assert.equal(second.etag, "7b9f8d1c2e3a");
      assert.equal(second.size, 2048);
    });

    it("should handle empty bucket results gracefully", () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>empty-bucket</Name>
  <Prefix></Prefix>
  <KeyCount>0</KeyCount>
  <MaxKeys>1000</MaxKeys>
  <IsTruncated>false</IsTruncated>
</ListBucketResult>`;

      const parsed = parseListBucketResultXml(xml);
      assert.equal(parsed.bucket, "empty-bucket");
      assert.equal(parsed.isTruncated, false);
      assert.equal(parsed.objects.length, 0);
    });
  });

  describe("S3 Connector Lifecycle & Incremental Ingestion", () => {
    it("should discover, fetch, and normalize documents via Mock S3 layer", async () => {
      const mockFiles = {
        "docs/overview.md": {
          content: "# Knowledge System\n\nThis is an autonomous graph system.",
          lastModified: new Date("2026-09-06T10:00:00.000Z"),
          etag: "etag_overview_1",
        },
        "docs/config.json": {
          content: '{"setting": "enabled"}',
          lastModified: new Date("2026-09-06T10:30:00.000Z"),
          etag: "etag_config_1",
        },
      };

      const testProgram = Effect.gen(function* () {
        const service = yield* S3ConnectorService;
        const connector = yield* service.createConnector("main");

        // 1. Connect
        yield* connector.connect();

        // 2. Discover without cursor (initial sync)
        const discovered = yield* connector.discover(Option.none());
        assert.equal(discovered.length, 2);

        // 3. Fetch first item
        const extracted = yield* connector.fetch(discovered[0]);
        assert.equal(extracted.document.title, "Knowledge System");
        assert.equal(extracted.document.source, "s3");
        assert.equal(extracted.document.namespace, "main");
        assert.ok(
          extracted.document.id.startsWith("doc_s3_main_docs_overview"),
        );
        assert.equal(extracted.provenance.source, "s3");
        assert.equal(extracted.provenance.uri, "s3://main/docs/overview.md");

        // 4. Create Checkpoint
        const checkpoint = connector.checkpoint({
          lastSyncTimestamp: "2026-09-06T10:30:00.000Z",
          processedKeys: {
            "docs/overview.md": "etag_overview_1",
            "docs/config.json": "etag_config_1",
          },
        });
        assert.equal(checkpoint.connectorId, "mock_s3_main");
        assert.equal(checkpoint.status, "IDLE");

        // 5. Discover with cursor (incremental check - no new files)
        const cursor: S3CursorData = {
          lastSyncTimestamp: "2026-09-06T11:00:00.000Z",
          processedKeys: {
            "docs/overview.md": "etag_overview_1",
            "docs/config.json": "etag_config_1",
          },
        };
        const incrementalDiscovered = yield* connector.discover(
          Option.some(cursor),
        );
        assert.equal(
          incrementalDiscovered.length,
          0,
          "Unchanged files should be skipped",
        );
      }).pipe(Effect.provide(S3ConnectorService.Mock(mockFiles)));

      await Effect.runPromise(testProgram);
    });

    it("should re-ingest modified files when ETag or timestamp changes", async () => {
      const mockFiles = {
        "docs/overview.md": {
          content: "# Updated System\n\nContent changed.",
          lastModified: new Date("2026-09-06T12:00:00.000Z"),
          etag: "etag_overview_v2", // changed etag!
        },
      };

      const testProgram = Effect.gen(function* () {
        const service = yield* S3ConnectorService;
        const connector = yield* service.createConnector("legal");

        const oldCursor: S3CursorData = {
          lastSyncTimestamp: "2026-09-06T10:00:00.000Z",
          processedKeys: {
            "docs/overview.md": "etag_overview_v1",
          },
        };

        const discovered = yield* connector.discover(Option.some(oldCursor));
        assert.equal(
          discovered.length,
          1,
          "Modified file with new etag should be re-discovered",
        );
        assert.equal(discovered[0].eTag, "etag_overview_v2");
      }).pipe(Effect.provide(S3ConnectorService.Mock(mockFiles)));

      await Effect.runPromise(testProgram);
    });
  });
});
