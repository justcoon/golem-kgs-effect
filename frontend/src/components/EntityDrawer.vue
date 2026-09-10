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
const docsExpanded = ref(true);

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
        const id = getDocId(d);
        const label = getDocLabel(d) || id;
        if (id && id.trim().length > 0) {
          const trimmed = id.trim();
          initialFallback.push({
            id: trimmed,
            title: label,
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
  const k = String(key).toLowerCase().replace(/[-_]/g, '');
  return (
    k === 'extractedfromdocument' ||
    k === 'documents' ||
    k === 'document' ||
    k === 'doc' ||
    k === 'docs' ||
    k === 'documentid' ||
    k === 'sourcekey' ||
    k === 'sourceurl'
  );
}

const displayProperties = computed<Record<string, unknown>>(() => {
  if (!props.entity?.properties) return {};
  const filtered: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(props.entity.properties)) {
    if (!isDocKey(key)) {
      filtered[key] = val;
    }
  }
  return filtered;
});

function getDocId(d: unknown): string {
  if (!d) return '';
  if (typeof d === 'string') return d;
  if (typeof d === 'object') {
    const obj = d as Record<string, unknown>;
    return String(obj.id || obj.sourceKey || obj.title || '');
  }
  return String(d);
}

function getDocLabel(d: unknown): string {
  if (!d) return '';
  if (typeof d === 'string') return d;
  if (typeof d === 'object') {
    const obj = d as Record<string, unknown>;
    return String(obj.title || obj.sourceKey || obj.id || JSON.stringify(obj));
  }
  return String(d);
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
          <button
            type="button"
            class="section-toggle-btn"
            @click="docsExpanded = !docsExpanded"
            :aria-expanded="docsExpanded"
          >
            <div class="section-toggle-left">
              <span class="collapse-icon" :class="{ open: docsExpanded }">▶</span>
              <span class="section-label">Related Documents</span>
              <span v-if="relatedDocs.length > 0" class="badge-count">{{ relatedDocs.length }}</span>
              <span v-if="loadingDocs" class="loading-spinner-tiny" title="Loading related documents...">⏳</span>
            </div>
            <span class="toggle-hint">{{ docsExpanded ? 'Hide' : 'Show' }}</span>
          </button>

          <transition name="expand">
            <div v-show="docsExpanded" class="related-docs-content">
              <div v-if="relatedDocs.length > 0" class="related-docs-list">
                <div
                  v-for="doc in relatedDocs"
                  :key="doc.id"
                  class="related-doc-card"
                >
                  <div class="doc-card-main" @click="navigateToDoc(doc.id)">
                    <div class="doc-icon-wrap" :class="doc.source || 'document'">
                      <span class="doc-icon">{{ doc.source === 'web' ? '🌐' : '📄' }}</span>
                    </div>
                    <div class="doc-content">
                      <div class="doc-title-row">
                        <span class="doc-title-text" :title="doc.title || doc.id">{{ doc.title || doc.id }}</span>
                        <div class="doc-badges">
                          <span v-if="doc.id === extractedFromDoc || doc.sourceKey === extractedFromDoc" class="origin-tag" title="First extracted from this document">Origin</span>
                          <span class="source-tag" :class="doc.source || 'document'">{{ (doc.source || 'document').toUpperCase() }}</span>
                        </div>
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
              <div v-else-if="!loadingDocs" class="empty-docs-msg">
                No related documents indexed yet.
              </div>
            </div>
          </transition>
        </div>

        <div v-if="entity.description" class="drawer-section">
          <label class="section-label">Description</label>
          <p class="section-text">{{ entity.description }}</p>
        </div>

        <div class="drawer-section">
          <label class="section-label">Properties</label>
          <div v-if="Object.keys(displayProperties).length > 0" class="props-grid">
            <div
              v-for="(val, key) in displayProperties"
              :key="key"
              class="prop-item"
            >
              <span class="prop-key">{{ key }}</span>
              <span class="prop-value">{{ typeof val === 'object' ? JSON.stringify(val) : val }}</span>
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
  max-width: 480px;
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

.section-toggle-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 6px 8px;
  border-radius: 6px;
  transition: background 0.15s ease;
  user-select: none;
}

.section-toggle-btn:hover {
  background: rgba(255, 255, 255, 0.04);
}

.section-toggle-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.collapse-icon {
  font-size: 0.65rem;
  color: var(--text-muted);
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), color 0.2s;
  display: inline-block;
  line-height: 1;
}

.collapse-icon.open {
  transform: rotate(90deg);
  color: #38bdf8;
}

.section-toggle-btn .section-label {
  display: inline-block;
  margin-bottom: 0;
  cursor: pointer;
  transition: color 0.2s;
}

.section-toggle-btn:hover .section-label {
  color: #f1f5f9;
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

.toggle-hint {
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--text-muted);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 2px 8px;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.section-toggle-btn:hover .toggle-hint {
  color: #f1f5f9;
  background: rgba(255, 255, 255, 0.09);
  border-color: rgba(255, 255, 255, 0.18);
}

.related-docs-content {
  margin-top: 4px;
}

.expand-enter-active,
.expand-leave-active {
  transition: all 0.22s ease-out;
  overflow: hidden;
}

.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.related-docs-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  box-sizing: border-box;
}

.related-doc-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: linear-gradient(135deg, rgba(30, 41, 59, 0.75), rgba(15, 23, 42, 0.85));
  border: 1px solid rgba(56, 189, 248, 0.22);
  border-radius: 10px;
  padding: 12px;
  position: relative;
  overflow: hidden;
  transition: border-color 0.2s, background 0.2s;
  width: 100%;
  box-sizing: border-box;
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
  width: 100%;
  box-sizing: border-box;
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
  margin-top: 2px;
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
  gap: 4px;
}

.doc-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
}

.doc-title-text {
  font-size: 0.88rem;
  font-weight: 600;
  color: #f1f5f9;
  line-height: 1.4;
  word-break: break-word;
  overflow-wrap: anywhere;
  flex: 1;
  min-width: 0;
}

.doc-badges {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  margin-top: 1px;
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
  font-size: 0.74rem;
  color: var(--text-muted, #94a3b8);
  line-height: 1.4;
  word-break: break-all;
  overflow-wrap: anywhere;
  background: rgba(0, 0, 0, 0.28);
  padding: 5px 8px;
  border-radius: 5px;
  margin-top: 4px;
  width: 100%;
  box-sizing: border-box;
}

.doc-actions-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  flex-wrap: wrap;
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

.prop-docs-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
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
