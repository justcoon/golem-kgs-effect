<script setup lang="ts">
import { computed, ref } from 'vue';
import { marked } from 'marked';
import type { DocumentResult } from '../types/api';

const props = defineProps<{
  document: DocumentResult | null;
  show: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const copied = ref(false);

const renderedContent = computed(() => {
  if (!props.document?.content) return '';
  return marked(props.document.content);
});

const webUrl = computed(() => {
  if (!props.document) return null;
  const candidate =
    props.document.metadata?.url ||
    props.document.metadata?.canonicalUrl ||
    props.document.sourceKey;
  if (
    typeof candidate === 'string' &&
    (candidate.startsWith('http://') || candidate.startsWith('https://'))
  ) {
    return candidate;
  }
  return null;
});

const isWebDocument = computed(() => {
  return props.document?.source === 'web' || !!webUrl.value;
});

const formatDate = (dateStr?: string) => {
  if (!dateStr) return 'N/A';
  try {
    return new Date(dateStr).toLocaleString();
  } catch {
    return dateStr;
  }
};

const copyContent = async () => {
  if (props.document?.content) {
    await navigator.clipboard.writeText(props.document.content);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  }
};
</script>

<template>
  <div v-if="show && document" class="modal-overlay" @click.self="emit('close')">
    <div class="modal-content glass animate-fade-in">
      <div class="modal-header">
        <div class="header-main">
          <h2>{{ document.title || 'Document Preview' }}</h2>
          <span class="doc-id">{{ document.id }}</span>
        </div>
        <div class="header-actions">
          <a
            v-if="webUrl"
            :href="webUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="open-web-btn"
            title="Open original webpage in a new tab"
          >
            🌐 Open Web Page ↗
          </a>
          <button class="copy-btn" @click="copyContent">
            {{ copied ? '✓ Copied' : '📋 Copy Text' }}
          </button>
          <button class="close-btn" @click="emit('close')">&times;</button>
        </div>
      </div>

      <div class="modal-body">
        <div class="metadata-grid">
          <div class="meta-item">
            <span class="label">Source</span>
            <span class="value">{{ document.source || 'N/A' }}</span>
          </div>
          <div class="meta-item">
            <span class="label">Resource</span>
            <span class="value">{{ document.resourceName || document.namespace || 'N/A' }}</span>
          </div>
          <div v-if="document.sourceKey" class="meta-item" :class="{ 'meta-item-wide': !!webUrl }">
            <span class="label">{{ isWebDocument ? 'Web URL' : 'File / Key' }}</span>
            <a
              v-if="webUrl"
              :href="webUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="value doc-key web-link"
              title="Open URL in new tab"
            >
              {{ document.sourceKey }}
              <span class="link-arrow">↗</span>
            </a>
            <span v-else class="value doc-key">{{ document.sourceKey }}</span>
          </div>
          <div
            v-if="document.metadata?.canonicalUrl && document.metadata.canonicalUrl !== document.sourceKey"
            class="meta-item meta-item-wide"
          >
            <span class="label">Canonical URL</span>
            <a
              :href="document.metadata.canonicalUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="value doc-key web-link"
              title="Open canonical URL in new tab"
            >
              {{ document.metadata.canonicalUrl }}
              <span class="link-arrow">↗</span>
            </a>
          </div>
          <div class="meta-item">
            <span class="label">Size</span>
            <span class="value">{{ document.sizeBytes ? (document.sizeBytes / 1024).toFixed(1) + ' KB' : 'N/A' }}</span>
          </div>
          <div class="meta-item">
            <span class="label">Updated</span>
            <span class="value">{{ formatDate(document.updatedAt || document.createdAt) }}</span>
          </div>
          <div v-if="document.tags && document.tags.length > 0" class="meta-item tags">
            <span class="label">Tags</span>
            <div class="tag-list">
              <span v-for="tag in document.tags" :key="tag" class="small-tag">{{ tag }}</span>
            </div>
          </div>
        </div>

        <div class="content-preview markdown-body" v-html="renderedContent"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(6px);
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.modal-content {
  width: 100%;
  max-width: 900px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
  background: #0f172a;
  border: 1px solid var(--border-color);
  border-radius: 16px;
}

.modal-header {
  padding: 20px 24px;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  background: rgba(255, 255, 255, 0.02);
}

.header-main h2 {
  font-size: 1.4rem;
  margin: 0 0 4px 0;
  color: var(--text-main);
}

.doc-id {
  font-family: monospace;
  font-size: 0.8rem;
  color: var(--text-muted);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.open-web-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.25), rgba(147, 51, 234, 0.3));
  border: 1px solid rgba(147, 51, 234, 0.45);
  color: #93c5fd;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.2s ease;
}

.open-web-btn:hover {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.4), rgba(147, 51, 234, 0.5));
  border-color: #60a5fa;
  color: #ffffff;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.25);
}

.copy-btn {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid var(--border-color);
  color: var(--text-main);
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.2s;
}

.copy-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  transform: none;
  box-shadow: none;
}

.close-btn {
  background: transparent;
  border: none;
  font-size: 1.8rem;
  color: var(--text-muted);
  line-height: 1;
  padding: 0;
  cursor: pointer;
}

.close-btn:hover {
  color: white;
  transform: none;
  box-shadow: none;
}

.modal-body {
  padding: 24px;
  overflow-y: auto;
  flex: 1;
}

.metadata-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.meta-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.meta-item.tags {
  grid-column: 1 / -1;
}

.label {
  font-size: 0.7rem;
  text-transform: uppercase;
  color: var(--text-muted);
  font-weight: 700;
  letter-spacing: 0.05em;
}

.value {
  font-size: 0.9rem;
  font-weight: 500;
  word-break: break-all;
}

.doc-key {
  font-family: monospace;
  font-size: 0.8rem;
  color: var(--primary, #a78bfa);
}

.web-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #60a5fa !important;
  text-decoration: none;
  transition: color 0.15s ease;
}

.web-link:hover {
  color: #93c5fd !important;
  text-decoration: underline;
}

.link-arrow {
  font-size: 0.85em;
  opacity: 0.85;
}

.meta-item-wide {
  grid-column: span 2;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.small-tag {
  font-size: 0.75rem;
  padding: 2px 8px;
  background: rgba(139, 92, 246, 0.15);
  border: 1px solid rgba(139, 92, 246, 0.3);
  border-radius: 6px;
  color: #c084fc;
}

.content-preview {
  line-height: 1.7;
  color: #cbd5e1;
  padding-top: 8px;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3) {
  margin-top: 1.4em;
  margin-bottom: 0.5em;
  color: #f8fafc;
}

.markdown-body :deep(p) {
  margin-bottom: 1em;
}

.markdown-body :deep(code) {
  background: rgba(255, 255, 255, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.85em;
  color: #38bdf8;
}

.markdown-body :deep(pre) {
  background: rgba(0, 0, 0, 0.5);
  padding: 16px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  overflow-x: auto;
  margin-bottom: 1.2em;
}
</style>
