<script setup lang="ts">
import { ref, computed } from 'vue';
import { marked } from 'marked';
import { ApiService } from '../services/api';
import type { AnswerResponse, EntityResult, Citation } from '../types/api';

const emit = defineEmits<{
  (e: 'preview-document', docId: string): void;
  (e: 'inspect-entity', entityId: string): void;
  (e: 'explore-neighborhood', entityId: string): void;
}>();

const question = ref('');
const topK = ref(5);
const maxHops = ref(2);
const loading = ref(false);
const error = ref<string | null>(null);
const response = ref<AnswerResponse | null>(null);
const entitiesExpanded = ref(false);
const relationshipsExpanded = ref(false);

const sampleQuestions = [
  "What is Golem Cloud and how does it achieve durable execution?",
  "Which components depend on PostgreSQL and pgvector?",
  "How does the GraphRAG service extract entities and relationships?",
  "Explain the role of IngestionCoordinatorAgent.",
];

const renderedAnswer = computed(() => {
  if (!response.value?.answer) return '';
  return marked(response.value.answer);
});

const formatPercent = (val?: number) => {
  if (val === undefined || val === null) return '0%';
  return `${Math.round(val * 100)}%`;
};

async function handleAsk(queryText?: string) {
  const q = (queryText || question.value).trim();
  if (!q) return;

  question.value = q;
  loading.value = true;
  error.value = null;
  response.value = null;

  try {
    const res = await ApiService.ask(q, {
      topK: topK.value,
      maxHops: maxHops.value,
      generateAnswer: true,
    });
    response.value = res;
  } catch (err: any) {
    error.value = err.message || 'Failed to query GraphRAG. Please ensure Golem server is running.';
  } finally {
    loading.value = false;
  }
}

function handleSelectEntity(entity: EntityResult) {
  emit('inspect-entity', entity.id);
}
</script>

<template>
  <div class="ask-view animate-fade-in">
    <!-- Question Input Card -->
    <div class="query-card glass">
      <div class="input-row">
        <span class="query-icon">✨</span>
        <input
          v-model="question"
          type="text"
          placeholder="Ask anything about the knowledge base..."
          class="query-input"
          @keyup.enter="handleAsk()"
        />
        <button
          class="ask-button"
          :disabled="loading || !question.trim()"
          @click="handleAsk()"
        >
          <span v-if="loading" class="spinner"></span>
          <span v-else>Ask GraphRAG</span>
        </button>
      </div>

      <!-- Controls & Options -->
      <div class="query-controls">
        <div class="control-item">
          <label>Context Chunks (top-K):</label>
          <select v-model.number="topK" class="select-pill">
            <option :value="3">3 Chunks</option>
            <option :value="5">5 Chunks</option>
            <option :value="10">10 Chunks</option>
          </select>
        </div>
        <div class="control-item">
          <label>Graph Traversal (Hops):</label>
          <select v-model.number="maxHops" class="select-pill">
            <option :value="1">1 Hop</option>
            <option :value="2">2 Hops</option>
            <option :value="3">3 Hops</option>
          </select>
        </div>
      </div>

      <!-- Quick prompts -->
      <div class="sample-prompts">
        <span class="prompt-label">Try asking:</span>
        <button
          v-for="sample in sampleQuestions"
          :key="sample"
          class="prompt-chip"
          @click="handleAsk(sample)"
        >
          {{ sample }}
        </button>
      </div>
    </div>

    <!-- Error State -->
    <div v-if="error" class="error-banner glass animate-fade-in">
      <span class="err-icon">⚠️</span>
      <p>{{ error }}</p>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="loading-state animate-fade-in">
      <div class="loader-pulse"></div>
      <p>Retrieving chunks, traversing knowledge graph & synthesizing answer...</p>
    </div>

    <!-- Answer & Grounding Section -->
    <div v-if="response && !loading" class="response-section animate-fade-in">
      <!-- Synthesized Answer Card -->
      <div class="answer-card glass">
        <div class="card-top">
          <div class="answer-badge">
            <span class="badge-dot"></span>
            Synthesized Answer
          </div>
          <div v-if="response.confidenceScore !== undefined" class="confidence-badge">
            <span>Confidence:</span>
            <strong>{{ formatPercent(response.confidenceScore) }}</strong>
          </div>
        </div>

        <div class="answer-body markdown-body" v-html="renderedAnswer"></div>

        <!-- Grounded Entities Section -->
        <div v-if="response.groundedEntities && response.groundedEntities.length > 0" class="grounding-block">
          <button
            type="button"
            class="grounding-toggle-btn"
            @click="entitiesExpanded = !entitiesExpanded"
            :aria-expanded="entitiesExpanded"
          >
            <div class="grounding-toggle-left">
              <span class="collapse-icon" :class="{ open: entitiesExpanded }">▶</span>
              <span class="block-label">Grounded Entities</span>
              <span class="badge-count">{{ response.groundedEntities.length }}</span>
            </div>
            <span class="toggle-hint">{{ entitiesExpanded ? 'Hide' : 'Show' }}</span>
          </button>

          <transition name="expand">
            <div v-show="entitiesExpanded" class="entities-wrap">
              <button
                v-for="ent in response.groundedEntities"
                :key="ent.id"
                class="entity-pill"
                @click="handleSelectEntity(ent)"
                title="Click to view details"
              >
                <span class="ent-type">{{ ent.entityType || 'ENTITY' }}</span>
                <span class="ent-name">{{ ent.name || ent.id }}</span>
              </button>
            </div>
          </transition>
        </div>

        <!-- Grounded Relationships Section -->
        <div v-if="response.groundedRelationships && response.groundedRelationships.length > 0" class="grounding-block">
          <button
            type="button"
            class="grounding-toggle-btn"
            @click="relationshipsExpanded = !relationshipsExpanded"
            :aria-expanded="relationshipsExpanded"
          >
            <div class="grounding-toggle-left">
              <span class="collapse-icon" :class="{ open: relationshipsExpanded }">▶</span>
              <span class="block-label">Grounded Relationships</span>
              <span class="badge-count">{{ response.groundedRelationships.length }}</span>
            </div>
            <span class="toggle-hint">{{ relationshipsExpanded ? 'Hide' : 'Show' }}</span>
          </button>

          <transition name="expand">
            <div v-show="relationshipsExpanded" class="edges-wrap">
              <span
                v-for="edge in response.groundedRelationships"
                :key="`${edge.sourceId}-${edge.relationType}-${edge.targetId}`"
                class="edge-pill"
              >
                <code class="edge-node">{{ edge.sourceId }}</code>
                <span class="edge-rel">── {{ edge.relationType }} ──▶</span>
                <code class="edge-node">{{ edge.targetId }}</code>
                <span v-if="edge.confidence" class="edge-conf">{{ formatPercent(edge.confidence) }}</span>
              </span>
            </div>
          </transition>
        </div>
      </div>

      <!-- Citations Drawer/List -->
      <div v-if="response.citations && response.citations.length > 0" class="citations-card glass">
        <h4 class="citations-title">
          <span>📚 Source Citations</span>
          <span class="citation-count">{{ response.citations.length }}</span>
        </h4>
        <div class="citations-grid">
          <div
            v-for="(citation, idx) in response.citations"
            :key="idx"
            class="citation-item"
          >
            <div class="citation-header">
              <span class="citation-index">#{{ idx + 1 }}</span>
              <span class="citation-title-text" :title="citation.title || citation.documentId">{{ citation.title || citation.documentId }}</span>
              <button
                class="view-doc-btn"
                @click="emit('preview-document', citation.documentId)"
                title="Preview document"
              >
                📄 View Document
              </button>
            </div>
            <p class="citation-excerpt">"{{ citation.excerpt }}"</p>
            <div class="citation-footer">
              <div class="citation-meta">
                <span class="meta-label">Doc ID:</span>
                <code
                  class="doc-id-code"
                  @click="emit('preview-document', citation.documentId)"
                  :title="`Preview document: ${citation.documentId}`"
                >{{ citation.documentId }}</code>
              </div>
              <a
                v-if="citation.sourceUri && (citation.sourceUri.startsWith('http://') || citation.sourceUri.startsWith('https://'))"
                :href="citation.sourceUri"
                target="_blank"
                rel="noopener noreferrer"
                class="citation-uri citation-link"
                :title="`Open ${citation.sourceUri} in new tab`"
              >
                {{ citation.sourceUri }} ↗
              </a>
              <span v-else-if="citation.sourceUri" class="citation-uri" :title="citation.sourceUri">{{ citation.sourceUri }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ask-view {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.query-card {
  padding: 24px;
}

.input-row {
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 8px 12px 8px 16px;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.input-row:focus-within {
  border-color: var(--primary);
  box-shadow: 0 0 16px rgba(139, 92, 246, 0.25);
}

.query-icon {
  font-size: 1.3rem;
}

.query-input {
  flex: 1;
  background: transparent;
  border: none;
  color: var(--text-main);
  font-size: 1.05rem;
}

.query-input::placeholder {
  color: var(--text-muted);
}

.ask-button {
  background: linear-gradient(135deg, #8b5cf6, #3b82f6);
  border: none;
  border-radius: 8px;
  padding: 10px 20px;
  color: white;
  font-weight: 600;
  font-size: 0.95rem;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 140px;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

.ask-button:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(139, 92, 246, 0.4);
}

.ask-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.query-controls {
  display: flex;
  gap: 24px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.control-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  color: var(--text-muted);
}

.select-pill {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-color);
  color: var(--text-main);
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 0.85rem;
  outline: none;
}

.sample-prompts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
}

.prompt-label {
  font-size: 0.8rem;
  color: var(--text-muted);
}

.prompt-chip {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--text-muted);
  font-size: 0.8rem;
  padding: 4px 10px;
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
}

.prompt-chip:hover {
  background: rgba(139, 92, 246, 0.15);
  border-color: #8b5cf6;
  color: white;
  transform: translateY(-1px);
}

.error-banner {
  padding: 16px 20px;
  border-color: rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.1);
  color: #fca5a5;
  display: flex;
  align-items: center;
  gap: 12px;
}

.loading-state {
  text-align: center;
  padding: 48px 24px;
  color: var(--text-muted);
}

.loader-pulse {
  width: 48px;
  height: 48px;
  margin: 0 auto 16px;
  border-radius: 50%;
  background: linear-gradient(135deg, #8b5cf6, #06b6d4);
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0% { transform: scale(0.9); opacity: 0.7; }
  50% { transform: scale(1.1); opacity: 1; filter: drop-shadow(0 0 15px #8b5cf6); }
  100% { transform: scale(0.9); opacity: 0.7; }
}

.response-section {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.answer-card {
  padding: 28px;
}

.card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.answer-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 0.9rem;
  color: #c084fc;
}

.badge-dot {
  width: 8px;
  height: 8px;
  background: #a855f7;
  border-radius: 50%;
  box-shadow: 0 0 8px #a855f7;
}

.confidence-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85rem;
  color: var(--text-muted);
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.3);
  padding: 4px 10px;
  border-radius: 999px;
}

.confidence-badge strong {
  color: #34d399;
}

.answer-body {
  font-size: 1.05rem;
  line-height: 1.8;
  color: #f1f5f9;
}

.grounding-block {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.grounding-toggle-btn {
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

.grounding-toggle-btn:hover {
  background: rgba(255, 255, 255, 0.04);
}

.grounding-toggle-left {
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

.grounding-toggle-btn .block-label {
  display: inline-block;
  font-size: 0.75rem;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--text-muted);
  letter-spacing: 0.05em;
  margin-bottom: 0;
  transition: color 0.2s;
}

.grounding-toggle-btn:hover .block-label {
  color: #f1f5f9;
}

.badge-count {
  font-size: 0.72rem;
  font-weight: 700;
  background: rgba(56, 189, 248, 0.15);
  border: 1px solid rgba(56, 189, 248, 0.3);
  color: #38bdf8;
  padding: 1px 7px;
  border-radius: 10px;
}

.toggle-hint {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-muted);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 2px 8px;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.grounding-toggle-btn:hover .toggle-hint {
  color: #f1f5f9;
  background: rgba(255, 255, 255, 0.09);
  border-color: rgba(255, 255, 255, 0.18);
}

.entities-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
  padding-left: 4px;
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

.entity-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(139, 92, 246, 0.12);
  border: 1px solid rgba(139, 92, 246, 0.3);
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.entity-pill:hover {
  background: rgba(139, 92, 246, 0.25);
  border-color: #a855f7;
  transform: translateY(-1px);
}

.ent-type {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  color: #c084fc;
}

.ent-name {
  font-size: 0.85rem;
  color: #f8fafc;
  font-weight: 500;
}

.edges-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
  padding-left: 4px;
}

.edge-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 0.85rem;
}

.edge-node {
  color: #38bdf8;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.8rem;
}

.edge-rel {
  color: #a855f7;
  font-size: 0.75rem;
  font-weight: 600;
}

.edge-conf {
  margin-left: auto;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.citations-card {
  padding: 24px;
}

.citations-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 1.1rem;
  margin-bottom: 16px;
}

.citation-count {
  background: rgba(255, 255, 255, 0.1);
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.8rem;
}

.citations-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr));
  gap: 16px;
  min-width: 0;
}

.citation-item {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  overflow: hidden;
  transition: border-color 0.2s, background 0.2s;
}

.citation-item:hover {
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.035);
}

.citation-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.citation-index {
  font-weight: 700;
  color: #c084fc;
  font-size: 0.85rem;
  flex-shrink: 0;
}

.citation-title-text {
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.view-doc-btn {
  background: rgba(56, 189, 248, 0.12);
  border: 1px solid rgba(56, 189, 248, 0.3);
  color: #7dd3fc;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: all 0.2s;
}

.view-doc-btn:hover {
  background: rgba(56, 189, 248, 0.25);
  border-color: rgba(56, 189, 248, 0.6);
  color: #bae6fd;
  transform: translateY(-1px);
}

.citation-excerpt {
  font-size: 0.85rem;
  line-height: 1.5;
  color: var(--text-muted);
  font-style: italic;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.citation-footer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.75rem;
  color: var(--text-muted);
  font-family: monospace;
  margin-top: auto;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  padding-top: 10px;
  min-width: 0;
}

.citation-meta {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  flex-wrap: wrap;
}

.meta-label {
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.doc-id-code {
  font-family: 'JetBrains Mono', monospace;
  color: #7dd3fc;
  background: rgba(56, 189, 248, 0.08);
  border: 1px solid rgba(56, 189, 248, 0.2);
  padding: 2px 6px;
  border-radius: 4px;
  word-break: break-all;
  overflow-wrap: anywhere;
  line-height: 1.35;
  cursor: pointer;
  transition: all 0.2s;
}

.doc-id-code:hover {
  background: rgba(56, 189, 248, 0.2);
  border-color: rgba(56, 189, 248, 0.5);
  color: #bae6fd;
}

.citation-uri {
  word-break: break-all;
  overflow-wrap: anywhere;
  color: #94a3b8;
  font-size: 0.72rem;
  line-height: 1.35;
}

.citation-link {
  color: #60a5fa;
  text-decoration: none;
  transition: color 0.15s ease;
}

.citation-link:hover {
  color: #93c5fd;
  text-decoration: underline;
}
</style>
