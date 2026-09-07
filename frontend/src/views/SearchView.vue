<script setup lang="ts">
import { ref } from 'vue';
import { ApiService } from '../services/api';
import type { SearchResponse, SearchResultItem, SearchType } from '../types/api';

const emit = defineEmits<{
  (e: 'preview-document', docId: string): void;
}>();

const query = ref('');
const searchType = ref<SearchType>('hybrid');
const limit = ref(10);
const loading = ref(false);
const error = ref<string | null>(null);
const searchResponse = ref<SearchResponse | null>(null);

const searchModes: { type: SearchType; label: string; desc: string }[] = [
  { type: 'hybrid', label: 'Hybrid (RRF)', desc: 'Combines vector semantics and keyword ranks' },
  { type: 'vector', label: 'Vector Only', desc: 'Dense semantic similarity search' },
  { type: 'keyword', label: 'Keyword Only', desc: 'Exact lexical matching' },
];

async function handleSearch() {
  const q = query.value.trim();
  if (!q) return;

  loading.value = true;
  error.value = null;

  try {
    const res = await ApiService.search(q, {
      limit: limit.value,
      searchType: searchType.value,
    });
    searchResponse.value = res;
  } catch (err: any) {
    error.value = err.message || 'Search failed. Please ensure the Golem server is running.';
  } finally {
    loading.value = false;
  }
}

function formatScore(score: number): string {
  if (score > 1) return score.toFixed(2);
  return (score * 100).toFixed(1) + '%';
}

function getScoreWidth(score: number): string {
  if (score > 1) return `${Math.min(100, Math.round(score * 10))}%`;
  return `${Math.min(100, Math.round(score * 100))}%`;
}
</script>

<template>
  <div class="search-view animate-fade-in">
    <!-- Search Configuration Card -->
    <div class="search-box-card glass">
      <div class="input-row">
        <span class="search-icon">🔍</span>
        <input
          v-model="query"
          type="text"
          placeholder="Search documentation, RFCs, and concepts..."
          class="search-input"
          @keyup.enter="handleSearch"
        />
        <button
          class="search-btn"
          :disabled="loading || !query.trim()"
          @click="handleSearch"
        >
          <span v-if="loading" class="spinner"></span>
          <span v-else>Search</span>
        </button>
      </div>

      <div class="search-toolbar">
        <div class="modes-group">
          <button
            v-for="mode in searchModes"
            :key="mode.type"
            class="mode-btn"
            :class="{ active: searchType === mode.type }"
            @click="searchType = mode.type"
            :title="mode.desc"
          >
            {{ mode.label }}
          </button>
        </div>

        <div class="limit-selector">
          <label>Results Limit:</label>
          <select v-model.number="limit" class="limit-select">
            <option :value="5">5</option>
            <option :value="10">10</option>
            <option :value="25">25</option>
          </select>
        </div>
      </div>
    </div>

    <!-- Error Banner -->
    <div v-if="error" class="error-banner glass animate-fade-in">
      <span class="err-icon">⚠️</span>
      <p>{{ error }}</p>
    </div>

    <!-- Results Overview Header -->
    <div v-if="searchResponse && !loading" class="results-header">
      <span class="results-count">
        Found <strong>{{ searchResponse.totalResults }}</strong> matching chunks for "<em>{{ searchResponse.query }}</em>"
      </span>
      <span class="results-mode">Mode: {{ searchType.toUpperCase() }}</span>
    </div>

    <!-- Results List -->
    <div v-if="searchResponse && searchResponse.results.length > 0 && !loading" class="results-list">
      <div
        v-for="item in searchResponse.results"
        :key="item.chunkId"
        class="result-card glass animate-fade-in"
      >
        <div class="card-header">
          <div class="header-left">
            <span class="score-pill">
              Score: <strong>{{ formatScore(item.score) }}</strong>
              <div class="score-bar" :style="{ width: getScoreWidth(item.score) }"></div>
            </span>
            <span v-if="item.metadata?.heading" class="heading-badge">
              📌 {{ item.metadata.heading }}
            </span>
          </div>

          <button
            class="preview-btn"
            @click="emit('preview-document', item.documentId)"
          >
            📄 Inspect Document
          </button>
        </div>

        <div class="chunk-content">
          <p>{{ item.content }}</p>
        </div>

        <div class="card-footer">
          <span class="doc-link">
            Document ID: <code>{{ item.documentId }}</code>
          </span>
          <span class="chunk-id">
            Chunk ID: <code>{{ item.chunkId }}</code>
          </span>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div v-else-if="!loading && !searchResponse" class="empty-state animate-fade-in">
      <div class="empty-icon">📂</div>
      <p>Enter a query above to search across ingested document chunks</p>
    </div>

    <!-- No Results State -->
    <div v-else-if="!loading && searchResponse && searchResponse.results.length === 0" class="empty-state animate-fade-in">
      <div class="empty-icon">🔎</div>
      <p>No results found matching "{{ searchResponse.query }}". Try adjusting search mode or query terms.</p>
    </div>
  </div>
</template>

<style scoped>
.search-view {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.search-box-card {
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

.search-icon {
  font-size: 1.2rem;
}

.search-input {
  flex: 1;
  background: transparent;
  border: none;
  color: var(--text-main);
  font-size: 1.05rem;
}

.search-btn {
  background: linear-gradient(135deg, #8b5cf6, #3b82f6);
  border: none;
  border-radius: 8px;
  padding: 10px 24px;
  color: white;
  font-weight: 600;
  font-size: 0.95rem;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

.search-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(139, 92, 246, 0.4);
}

.search-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.search-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  flex-wrap: wrap;
  gap: 12px;
}

.modes-group {
  display: flex;
  background: rgba(15, 23, 42, 0.5);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 3px;
  gap: 4px;
}

.mode-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.mode-btn:hover {
  color: white;
  transform: none;
  box-shadow: none;
}

.mode-btn.active {
  background: rgba(139, 92, 246, 0.3);
  color: #c084fc;
  border: 1px solid rgba(139, 92, 246, 0.4);
}

.limit-selector {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  color: var(--text-muted);
}

.limit-select {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-color);
  color: var(--text-main);
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 0.85rem;
  outline: none;
}

.results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 8px;
  font-size: 0.9rem;
  color: var(--text-muted);
}

.results-count strong {
  color: var(--text-main);
}

.results-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.result-card {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  transition: transform 0.2s, border-color 0.2s;
}

.result-card:hover {
  transform: translateY(-2px);
  border-color: rgba(139, 92, 246, 0.4);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.score-pill {
  position: relative;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-color);
  padding: 4px 12px;
  border-radius: 6px;
  font-size: 0.8rem;
  color: var(--text-muted);
}

.score-pill strong {
  color: #38bdf8;
}

.score-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 2px;
  background: linear-gradient(90deg, #38bdf8, #8b5cf6);
}

.heading-badge {
  font-size: 0.8rem;
  color: #c084fc;
  background: rgba(139, 92, 246, 0.1);
  border: 1px solid rgba(139, 92, 246, 0.25);
  padding: 2px 8px;
  border-radius: 4px;
}

.preview-btn {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--border-color);
  color: var(--text-main);
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 0.8rem;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s;
}

.preview-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: white;
  transform: none;
  box-shadow: none;
}

.chunk-content p {
  font-size: 0.95rem;
  line-height: 1.6;
  color: #cbd5e1;
  white-space: pre-wrap;
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.8rem;
  color: var(--text-muted);
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  padding-top: 10px;
  flex-wrap: wrap;
  gap: 8px;
}

.card-footer code {
  font-family: 'JetBrains Mono', monospace;
  color: #94a3b8;
  background: rgba(255, 255, 255, 0.04);
  padding: 2px 6px;
  border-radius: 4px;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-muted);
}

.empty-icon {
  font-size: 3rem;
  margin-bottom: 12px;
  opacity: 0.4;
}

.error-banner {
  padding: 16px;
  border-color: rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.1);
  color: #fca5a5;
  display: flex;
  align-items: center;
  gap: 12px;
}
</style>
