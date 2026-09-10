<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { EntityResult, DocumentSummary } from '../types/api';
import { ApiService } from '../services/api';

const props = defineProps<{
  entity: EntityResult | null;
  isOpen: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'explore', entityId: string): void;
  (e: 'open-document', docId: string): void;
  (e: 'preview-document', docId: string): void;
}>();

const extractedFromDoc = computed<string | null>(() => {
  if (!props.entity) return null;
  const doc =
    props.entity.properties?.extractedFromDocument ??
    props.entity.properties?.extracted_from_document ??
    props.entity.metadata?.extractedFromDocument ??
    (props.entity as any).extractedFromDocument;
  return typeof doc === 'string' && doc.trim().length > 0 ? doc.trim() : null;
});

const relatedDocs = ref<DocumentSummary[]>([]);
const loadingDocs = ref(false);

watch(
  () => [props.isOpen, props.entity?.id],
  async ([isOpen, entityId]) => {
    if (!isOpen || !entityId) {
      relatedDocs.value = [];
      return;
    }

    // Immediate fallback from properties if present
    const propsDocs = props.entity?.properties?.documents;
    const initialFallback: DocumentSummary[] = [];

    if (Array.isArray(propsDocs)) {
      for (const d of propsDocs) {
        if (typeof d === 'string' && d.trim().length > 0) {
          const trimmed = d.trim();
          initialFallback.push({
            id: trimmed,
            title: trimmed,
            source: trimmed.startsWith('http') ? 'web' : 'document',
            resourceName: 'default',
            sourceKey: trimmed,
            sizeBytes: 0,
            createdAt: '',
            updatedAt: '',
          });
        }
      }
    } else if (extractedFromDoc.value) {
      initialFallback.push({
        id: extractedFromDoc.value,
        title: extractedFromDoc.value,
        source: extractedFromDoc.value.startsWith('http') ? 'web' : 'document',
        resourceName: 'default',
        sourceKey: extractedFromDoc.value,
        sizeBytes: 0,
        createdAt: '',
        updatedAt: '',
      });
    }

    relatedDocs.value = initialFallback;
    loadingDocs.value = true;

    try {
      const fetched = await ApiService.getEntityDocuments(String(entityId));
      if (fetched && fetched.length > 0) {
        relatedDocs.value = fetched;
      }
    } catch {
      // Retain fallback list
    } finally {
      loadingDocs.value = false;
    }
  },
  { immediate: true }
);

function isDocKey(key: string | number): boolean {
  const k = String(key);
  return (
    k === 'extractedFromDocument' ||
    k === 'extracted_from_document' ||
    k === 'documents'
  );
}

function isWebUrl(sourceKey?: string, source?: string): boolean {
  if (source === 'web') return true;
  if (!sourceKey) return false;
  return sourceKey.startsWith('http://') || sourceKey.startsWith('https://');
}

function navigateToDoc(docId?: string | null) {
  const target = docId || extractedFromDoc.value;
  if (target) {
    emit('open-document', target);
    emit('preview-document', target);
  }
}
</script>

<template>
  <div v-if="isOpen && entity" class="drawer-overlay" @click.self="emit('close')">
    <div class="drawer-panel glass animate-slide-in">
      <div class="drawer-header">
        <div class="header-title">
          <span class="entity-type-badge">{{ entity.entityType || 'ENTITY' }}</span>
          <h3>{{ entity.name || entity.id }}</h3>
          <code class="entity-id">{{ entity.id }}</code>
        </div>
        <button class="close-btn" @click="emit('close')">&times;</button>
      </div>

      <div class="drawer-body">
        <div class="action-bar">
          <button class="action-btn primary" @click="emit('explore', entity.id)">
            🕸️ Explore Neighborhood
          </button>
        </div>

        <div
          v-if="loadingDocs || relatedDocs.length > 0 || extractedFromDoc"
          class="drawer-section related-docs-section"
        >
          <div class="section-header-row">
            <label class="section-label">Related Documents</label>
            <span v-if="relatedDocs.length > 0" class="badge-count">{{ relatedDocs.length }}</span>
            <span v-if="loadingDocs" class="loading-spinner-tiny" title="Loading related documents...">⏳</span>
          </div>

          <div class="related-docs-list">
            <div
              v-for="doc in relatedDocs"
              :key="doc.id"
              class="related-doc-card"
            >
              <div class="doc-card-main" @click="navigateToDoc(doc.id)">
                <div class="doc-icon-wrap" :class="doc.source">
                  <span class="doc-icon">{{ doc.source === 'web' ? '🌐' : '📄' }}</span>
                </div>
                <div class="doc-content">
                  <div class="doc-title-row">
                    <span class="doc-title-text" :title="doc.title || doc.id">{{ doc.title || doc.id }}</span>
                    <span v-if="doc.id === extractedFromDoc" class="origin-tag" title="First extracted from this document">Origin</span>
                    <span class="source-tag" :class="doc.source">{{ doc.source.toUpperCase() }}</span>
                  </div>
                  <div class="doc-sub-key" :title="doc.sourceKey || doc.id">{{ doc.sourceKey || doc.id }}</div>
                </div>
              </div>

              <div class="doc-actions-row">
                <button
                  class="doc-action-btn view-btn"
                  @click="navigateToDoc(doc.id)"
                  title="Open document preview modal"
                >
                  <span>👁️ Preview</span>
                </button>
                <a
                  v-if="isWebUrl(doc.sourceKey, doc.source)"
                  :href="doc.sourceKey"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="doc-action-btn web-btn"
                  title="Open live webpage in new tab"
                >
                  <span>🌐 Visit Page</span>
                  <span class="btn-arrow">↗</span>
                </a>
              </div>
            </div>
          </div>
        </div>

        <div v-if="entity.description" class="drawer-section">
          <label class="section-label">Description</label>
          <p class="section-text">{{ entity.description }}</p>
        </div>

        <div class="drawer-section">
          <label class="section-label">Properties</label>
          <div v-if="Object.keys(entity.properties || {}).length > 0" class="props-grid">
            <div
              v-for="(val, key) in entity.properties"
              :key="key"
              class="prop-item"
              :class="{ 'is-doc-prop': isDocKey(key) && typeof val === 'string' }"
            >
              <template v-if="isDocKey(key) && typeof val === 'string'">
                <div class="prop-doc-header">
                  <span class="prop-key">{{ key }}</span>
                  <span class="doc-pill-hint">Document</span>
                </div>
                <button
                  class="prop-doc-btn"
                  @click="navigateToDoc(val)"
                  :title="`Open document: ${val}`"
                >
                  <span class="doc-icon">📄</span>
                  <span class="doc-name">{{ val }}</span>
                  <span class="doc-arrow">↗</span>
                </button>
              </template>
              <template v-else>
                <span class="prop-key">{{ key }}</span>
                <span class="prop-value">{{ typeof val === 'object' ? JSON.stringify(val) : val }}</span>
              </template>
            </div>
          </div>
          <p v-else class="empty-muted">No custom properties</p>
        </div>

        <div v-if="entity.metadata && Object.keys(entity.metadata).length > 0" class="drawer-section">
          <label class="section-label">Metadata</label>
          <pre class="json-preview">{{ JSON.stringify(entity.metadata, null, 2) }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  z-index: 1050;
  display: flex;
  justify-content: flex-end;
}

.drawer-panel {
  width: 100%;
  max-width: 440px;
  height: 100%;
  background: #0f172a;
  border-left: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  box-shadow: -10px 0 30px rgba(0, 0, 0, 0.5);
  animation: slideIn 0.25s ease-out;
}

@keyframes slideIn {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

.drawer-header {
  padding: 24px;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.header-title {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.entity-type-badge {
  align-self: flex-start;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  background: rgba(139, 92, 246, 0.2);
  color: #c084fc;
  border: 1px solid rgba(139, 92, 246, 0.3);
}

.header-title h3 {
  font-size: 1.3rem;
  margin: 0;
}

.entity-id {
  font-family: monospace;
  font-size: 0.8rem;
  color: var(--text-muted);
}

.close-btn {
  background: transparent;
  border: none;
  font-size: 1.8rem;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.close-btn:hover {
  color: white;
  transform: none;
  box-shadow: none;
}

.drawer-body {
  padding: 24px;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.action-bar {
  display: flex;
  gap: 12px;
}

.action-btn {
  padding: 10px 16px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s, background 0.2s, border-color 0.2s;
}

.action-btn.primary {
  flex: 1;
  background: linear-gradient(135deg, #8b5cf6, #3b82f6);
  border: none;
  color: white;
}

.action-btn.primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 14px rgba(139, 92, 246, 0.4);
}

.action-btn.secondary.doc-action-btn {
  flex: 1;
  background: rgba(56, 189, 248, 0.12);
  border: 1px solid rgba(56, 189, 248, 0.35);
  color: #38bdf8;
}

.action-btn.secondary.doc-action-btn:hover {
  background: rgba(56, 189, 248, 0.24);
  border-color: rgba(56, 189, 248, 0.6);
  color: #7dd3fc;
  transform: translateY(-2px);
  box-shadow: 0 4px 14px rgba(56, 189, 248, 0.25);
}

.related-docs-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-header-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.badge-count {
  font-size: 0.75rem;
  font-weight: 700;
  background: rgba(56, 189, 248, 0.18);
  border: 1px solid rgba(56, 189, 248, 0.35);
  color: #38bdf8;
  padding: 1px 7px;
  border-radius: 10px;
}

.loading-spinner-tiny {
  font-size: 0.85rem;
  animation: pulse 1.5s infinite;
}

.related-docs-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 280px;
  overflow-y: auto;
  padding-right: 4px;
}

.related-doc-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: linear-gradient(135deg, rgba(30, 41, 59, 0.75), rgba(15, 23, 42, 0.85));
  border: 1px solid rgba(56, 189, 248, 0.22);
  border-radius: 10px;
  padding: 10px 12px;
  position: relative;
  overflow: hidden;
  transition: border-color 0.2s, background 0.2s;
}

.related-doc-card:hover {
  border-color: rgba(56, 189, 248, 0.45);
  background: linear-gradient(135deg, rgba(30, 41, 59, 0.9), rgba(15, 23, 42, 0.95));
}

.doc-card-main {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
}

.doc-icon-wrap {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: rgba(56, 189, 248, 0.14);
  border: 1px solid rgba(56, 189, 248, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  flex-shrink: 0;
}

.doc-icon-wrap.web {
  background: rgba(147, 51, 234, 0.15);
  border-color: rgba(147, 51, 234, 0.35);
}

.doc-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.doc-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.doc-title-text {
  font-size: 0.85rem;
  font-weight: 600;
  color: #f1f5f9;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
}

.origin-tag {
  font-size: 0.65rem;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(234, 179, 8, 0.18);
  border: 1px solid rgba(234, 179, 8, 0.4);
  color: #facc15;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.source-tag {
  font-size: 0.65rem;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(56, 189, 248, 0.12);
  border: 1px solid rgba(56, 189, 248, 0.25);
  color: #38bdf8;
  letter-spacing: 0.04em;
}

.source-tag.web {
  background: rgba(168, 85, 247, 0.15);
  border-color: rgba(168, 85, 247, 0.35);
  color: #c084fc;
}

.doc-sub-key {
  font-family: 'JetBrains Mono', monospace, sans-serif;
  font-size: 0.72rem;
  color: var(--text-muted, #94a3b8);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.doc-actions-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}

.doc-action-btn {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #cbd5e1;
  font-size: 0.75rem;
  font-weight: 500;
  padding: 4px 10px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  text-decoration: none;
  transition: all 0.15s ease;
}

.doc-action-btn:hover {
  background: rgba(255, 255, 255, 0.14);
  color: #ffffff;
  border-color: rgba(255, 255, 255, 0.25);
}

.doc-action-btn.web-btn {
  background: rgba(59, 130, 246, 0.15);
  border-color: rgba(59, 130, 246, 0.35);
  color: #93c5fd;
}

.doc-action-btn.web-btn:hover {
  background: rgba(59, 130, 246, 0.3);
  border-color: #60a5fa;
  color: #ffffff;
}

.doc-action-btn .btn-arrow {
  font-size: 0.8em;
  transition: transform 0.15s;
}

.doc-action-btn.web-btn:hover .btn-arrow {
  transform: translate(2px, -2px);
}

.drawer-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--text-muted);
  letter-spacing: 0.05em;
}

.section-text {
  font-size: 0.95rem;
  line-height: 1.6;
  color: var(--text-main);
}

.props-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 12px;
  min-width: 0;
  overflow: hidden;
}

.prop-item {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  font-size: 0.85rem;
  padding: 6px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  min-width: 0;
}

.prop-item:last-child {
  border-bottom: none;
}

.prop-item.is-doc-prop {
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  padding: 8px 0;
}

.prop-doc-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-width: 0;
}

.doc-pill-hint {
  font-size: 0.65rem;
  text-transform: uppercase;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(56, 189, 248, 0.15);
  color: #38bdf8;
  border: 1px solid rgba(56, 189, 248, 0.25);
  letter-spacing: 0.05em;
  flex-shrink: 0;
}

.prop-key {
  color: var(--text-muted);
  font-family: monospace;
  font-size: 0.8rem;
  flex-shrink: 0;
  max-width: 48%;
  word-break: break-word;
}

.prop-value {
  color: var(--text-main);
  font-weight: 500;
  text-align: right;
  word-break: break-word;
  overflow-wrap: anywhere;
  min-width: 0;
  flex: 1;
}

.prop-doc-btn {
  width: 100%;
  box-sizing: border-box;
  background: rgba(56, 189, 248, 0.1);
  border: 1px solid rgba(56, 189, 248, 0.3);
  border-radius: 8px;
  padding: 7px 10px;
  color: #7dd3fc;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s;
  min-width: 0;
}

.prop-doc-btn:hover {
  background: rgba(56, 189, 248, 0.22);
  border-color: rgba(56, 189, 248, 0.55);
  color: #bae6fd;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(56, 189, 248, 0.2);
}

.prop-doc-btn .doc-icon {
  font-size: 0.9rem;
  flex-shrink: 0;
}

.prop-doc-btn .doc-name {
  flex: 1;
  text-align: left;
  font-family: 'JetBrains Mono', monospace, sans-serif;
  font-size: 0.78rem;
  word-break: break-all;
  overflow-wrap: anywhere;
  line-height: 1.35;
  color: #e0f2fe;
}

.prop-doc-btn .doc-arrow {
  font-size: 0.8rem;
  color: #38bdf8;
  flex-shrink: 0;
  margin-left: auto;
  padding-left: 4px;
  transition: transform 0.2s;
}

.prop-doc-btn:hover .doc-arrow {
  transform: translate(2px, -2px);
}

.empty-muted {
  font-size: 0.85rem;
  color: var(--text-muted);
  font-style: italic;
}

.json-preview {
  background: rgba(0, 0, 0, 0.4);
  padding: 12px;
  border-radius: 8px;
  font-family: monospace;
  font-size: 0.75rem;
  overflow-x: auto;
  color: #94a3b8;
}
</style>
