import { Effect } from "effect";
import { type CreateChunkInput } from "../domain/chunk.js";
import { type RawDocument } from "../domain/provenance.js";

export interface ChunkerOptions {
  readonly maxChunkSize?: number;
  readonly chunkOverlap?: number;
  readonly minChunkSize?: number;
  readonly includeHeaderBreadcrumbs?: boolean;
}

export interface ChunkerResult {
  readonly documentId: string;
  readonly totalChunks: number;
  readonly chunks: ReadonlyArray<CreateChunkInput>;
}

const DEFAULT_MAX_CHUNK_SIZE = 800;
const DEFAULT_CHUNK_OVERLAP = 150;
const DEFAULT_MIN_CHUNK_SIZE = 50;

interface SectionBlock {
  readonly headerBreadcrumb: string;
  readonly text: string;
}

/**
 * Parses markdown text into sections, tracking active heading breadcrumbs.
 */
function parseMarkdownSections(markdown: string): SectionBlock[] {
  const lines = markdown.split(/\r?\n/);
  const sections: SectionBlock[] = [];
  const headerStack: { level: number; title: string }[] = [];
  let currentBuffer: string[] = [];

  const getBreadcrumb = () =>
    headerStack.map((h) => h.title.trim()).join(" > ");

  const flushBuffer = () => {
    const text = currentBuffer.join("\n").trim();
    if (text.length > 0) {
      sections.push({
        headerBreadcrumb: getBreadcrumb(),
        text,
      });
    }
    currentBuffer = [];
  };

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch && headerMatch[1] && headerMatch[2]) {
      flushBuffer();
      const level = headerMatch[1].length;
      const title = headerMatch[2].trim();

      while (
        headerStack.length > 0 &&
        (headerStack[headerStack.length - 1]?.level ?? 0) >= level
      ) {
        headerStack.pop();
      }
      headerStack.push({ level, title });
    } else {
      currentBuffer.push(line);
    }
  }

  flushBuffer();

  // If no sections were extracted (e.g. text without headers)
  if (sections.length === 0 && markdown.trim().length > 0) {
    sections.push({
      headerBreadcrumb: "",
      text: markdown.trim(),
    });
  }

  return sections;
}

/**
 * Splits large text blocks into sub-blocks respecting paragraph and sentence boundaries.
 */
function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function splitIntoSentences(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g);
  return sentences
    ? sentences.map((s) => s.trim()).filter((s) => s.length > 0)
    : [text];
}

/**
 * Document Chunker supporting semantic windowing, sliding window overlap,
 * and Markdown header hierarchy preservation.
 */
export class DocumentChunker {
  /**
   * Chunks a raw text string with document context.
   */
  static chunkText(
    documentId: string,
    text: string,
    options?: ChunkerOptions,
    baseMetadata?: Record<string, unknown>,
  ): ChunkerResult {
    const maxChunkSize = options?.maxChunkSize ?? DEFAULT_MAX_CHUNK_SIZE;
    const chunkOverlap = options?.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;
    const minChunkSize = options?.minChunkSize ?? DEFAULT_MIN_CHUNK_SIZE;
    const includeBreadcrumbs = options?.includeHeaderBreadcrumbs ?? true;

    if (!text || text.trim().length === 0) {
      return { documentId, totalChunks: 0, chunks: [] };
    }

    const sections = parseMarkdownSections(text);
    const rawChunks: { text: string; header: string }[] = [];

    for (const section of sections) {
      const paragraphs = splitIntoParagraphs(section.text);
      let currentChunkText = "";
      let lastOverlapText = "";

      for (const para of paragraphs) {
        if (para.length > maxChunkSize) {
          // Paragraph itself is larger than maxChunkSize, split by sentence
          const sentences = splitIntoSentences(para);
          for (const sentence of sentences) {
            if (currentChunkText.length + sentence.length + 1 > maxChunkSize) {
              if (currentChunkText.trim().length >= minChunkSize) {
                rawChunks.push({
                  text: currentChunkText.trim(),
                  header: section.headerBreadcrumb,
                });
                lastOverlapText = currentChunkText.slice(-chunkOverlap);
                currentChunkText =
                  lastOverlapText.length > 0
                    ? lastOverlapText + " " + sentence
                    : sentence;
              } else {
                currentChunkText += (currentChunkText ? " " : "") + sentence;
              }
            } else {
              currentChunkText += (currentChunkText ? " " : "") + sentence;
            }
          }
        } else if (currentChunkText.length + para.length + 2 > maxChunkSize) {
          if (currentChunkText.trim().length >= minChunkSize) {
            rawChunks.push({
              text: currentChunkText.trim(),
              header: section.headerBreadcrumb,
            });
            lastOverlapText = currentChunkText.slice(-chunkOverlap);
            currentChunkText =
              lastOverlapText.length > 0
                ? lastOverlapText + "\n\n" + para
                : para;
          } else {
            currentChunkText += (currentChunkText ? "\n\n" : "") + para;
          }
        } else {
          currentChunkText += (currentChunkText ? "\n\n" : "") + para;
        }
      }

      if (currentChunkText.trim().length >= minChunkSize) {
        rawChunks.push({
          text: currentChunkText.trim(),
          header: section.headerBreadcrumb,
        });
      }
    }

    // If all text was shorter than minChunkSize, preserve it as a single chunk
    if (rawChunks.length === 0 && text.trim().length > 0) {
      rawChunks.push({
        text: text.trim(),
        header: sections[0]?.headerBreadcrumb ?? "",
      });
    }

    let byteOffsetCursor = 0;
    const chunks: CreateChunkInput[] = rawChunks.map((item, index) => {
      let finalText = item.text;
      if (includeBreadcrumbs && item.header.length > 0) {
        finalText = `[Context: ${item.header}]\n${item.text}`;
      }

      const charCount = finalText.length;
      const tokenCount = Math.max(1, Math.ceil(charCount / 4));
      const byteStart = byteOffsetCursor;
      const byteEnd = byteStart + Buffer.byteLength(finalText, "utf8");
      byteOffsetCursor = byteEnd;

      return {
        id: `${documentId}_chunk_${index}`,
        documentId,
        chunkIndex: index,
        content: finalText,
        tokenCount,
        metadata: {
          ...(baseMetadata ?? {}),
          headerPath: item.header,
          charCount,
          byteOffsetStart: byteStart,
          byteOffsetEnd: byteEnd,
          isOverlapping: index > 0,
        },
      };
    });

    return {
      documentId,
      totalChunks: chunks.length,
      chunks,
    };
  }

  /**
   * Chunks a RawDocument domain model.
   */
  static chunkDocument(
    document: RawDocument,
    options?: ChunkerOptions,
  ): Effect.Effect<ChunkerResult> {
    return Effect.sync(() =>
      DocumentChunker.chunkText(document.id, document.content, options, {
        documentTitle: document.title,
        source: document.source,
        resourceName: document.resourceName,
        sourceKey: document.sourceKey,
        ...(document.metadata as Record<string, unknown>),
      }),
    );
  }
}
