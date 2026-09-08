<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ApiService } from './services/api';
import AskView from './views/AskView.vue';
import SearchView from './views/SearchView.vue';
import GraphView from './views/GraphView.vue';
import DocumentModal from './components/DocumentModal.vue';
import EntityDrawer from './components/EntityDrawer.vue';
import type { KnowledgeBaseOverview, DocumentResult, EntityResult } from './types/api';

type Tab = 'ask' | 'search' | 'graph';

const activeTab = ref<Tab>('ask');
const overview = ref<KnowledgeBaseOverview | null>(null);
const overviewLoading = ref(false);

// Document Preview Modal State
const selectedDocument = ref<DocumentResult | null>(null);
const showDocModal = ref(false);

// Entity Drawer State
const selectedEntity = ref<EntityResult | null>(null);
const showEntityDrawer = ref(false);

// Graph View Initial Entity Trigger
const initialGraphEntity = ref<string | null>(null);

async function loadOverview() {
  overviewLoading.value = true;
  try {
    overview.value = await ApiService.getOverview();
  } catch (err) {
    console.warn('Could not load knowledge base overview (backend might be starting):', err);
  } finally {
    overviewLoading.value = false;
  }
}

async function openDocument(docId: string) {
  try {
    const doc = await ApiService.getDocument(docId);
    if (doc) {
      selectedDocument.value = doc;
      showDocModal.value = true;
    } else {
      alert(`Document ${docId} not found.`);
    }
  } catch (err: any) {
    alert(`Failed to load document: ${err.message}`);
  }
}

async function inspectEntity(entityId: string) {
  try {
    const ent = await ApiService.getEntity(entityId);
    if (ent) {
      selectedEntity.value = ent;
    } else {
      // Create lightweight placeholder if not returned directly
      selectedEntity.value = {
        id: entityId,
        name: entityId,
        entityType: 'ENTITY',
        description: null,
        properties: {},
        metadata: {},
      };
    }
    showEntityDrawer.value = true;
  } catch {
    selectedEntity.value = {
      id: entityId,
      name: entityId,
      entityType: 'ENTITY',
      description: null,
      properties: {},
      metadata: {},
    };
    showEntityDrawer.value = true;
  }
}

function onExploreFromDrawer(entityId: string) {
  showEntityDrawer.value = false;
  initialGraphEntity.value = entityId;
  activeTab.value = 'graph';
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return 'Never';
  try {
    return new Date(dateStr).toLocaleString();
  } catch {
    return dateStr;
  }
}

onMounted(() => {
  loadOverview();
});
</script>

<template>
  <div class="app-layout">
    <!-- Top Navigation & Overview Header -->
    <header class="navbar-header glass">
      <div class="header-container">
        <!-- Logo & Title -->
        <div class="brand">
          <span class="brand-icon">🌐</span>
          <div class="brand-info">
            <h1 class="gradient-text">Golem KGS</h1>
            <span class="tagline">Knowledge Graph &amp; GraphRAG</span>
          </div>
        </div>

        <!-- Live Knowledge Base Overview Stats -->
        <div class="overview-stats">
          <div class="stat-bubble">
            <span class="bubble-label">Documents</span>
            <span class="bubble-val">{{ overview?.totalDocuments ?? '—' }}</span>
          </div>
          <div class="stat-bubble">
            <span class="bubble-label">Chunks</span>
            <span class="bubble-val">{{ overview?.totalChunks ?? '—' }}</span>
          </div>
          <div class="stat-bubble">
            <span class="bubble-label">Entities</span>
            <span class="bubble-val">{{ overview?.totalEntities ?? '—' }}</span>
          </div>
          <div class="stat-bubble">
            <span class="bubble-label">Edges</span>
            <span class="bubble-val">{{ overview?.totalRelationships ?? '—' }}</span>
          </div>
          <div class="stat-bubble sync-bubble" :title="overview?.lastSynchronizedAt ? `Last Sync: ${overview.lastSynchronizedAt}` : 'No sync recorded'">
            <span class="bubble-label">Last Sync</span>
            <span class="bubble-val sync-time">{{ formatDate(overview?.lastSynchronizedAt || null) }}</span>
          </div>
          <button class="reload-btn" :disabled="overviewLoading" @click="loadOverview" title="Refresh Statistics">
            <span :class="{ 'spin-icon': overviewLoading }">↻</span>
          </button>
        </div>
      </div>

      <!-- Tab Navigation -->
      <nav class="tabs-nav">
        <button
          class="tab-link"
          :class="{ active: activeTab === 'ask' }"
          @click="activeTab = 'ask'"
        >
          <span class="tab-icon">💬</span>
          <span>Ask (GraphRAG)</span>
        </button>
        <button
          class="tab-link"
          :class="{ active: activeTab === 'search' }"
          @click="activeTab = 'search'"
        >
          <span class="tab-icon">🔍</span>
          <span>Hybrid Search</span>
        </button>
        <button
          class="tab-link"
          :class="{ active: activeTab === 'graph' }"
          @click="activeTab = 'graph'"
        >
          <span class="tab-icon">🕸️</span>
          <span>Knowledge Graph</span>
        </button>
      </nav>
    </header>

    <!-- Main View Content Area -->
    <main class="main-content">
      <div class="content-container">
        <AskView
          v-if="activeTab === 'ask'"
          @preview-document="openDocument"
          @inspect-entity="inspectEntity"
          @explore-neighborhood="onExploreFromDrawer"
        />

        <SearchView
          v-else-if="activeTab === 'search'"
          @preview-document="openDocument"
        />

        <GraphView
          v-else-if="activeTab === 'graph'"
          :initial-entity-id="initialGraphEntity"
          @inspect-entity="inspectEntity"
        />
      </div>
    </main>

    <!-- Global Document Inspector Modal -->
    <DocumentModal
      :document="selectedDocument"
      :show="showDocModal"
      @close="showDocModal = false"
    />

    <!-- Global Entity Drawer -->
    <EntityDrawer
      :entity="selectedEntity"
      :is-open="showEntityDrawer"
      @close="showEntityDrawer = false"
      @explore="onExploreFromDrawer"
      @open-document="openDocument"
      @preview-document="openDocument"
    />

    <!-- Footer -->
    <footer class="app-footer">
      <div class="footer-container">
        <p>Built with <strong>Golem Cloud</strong>, <strong>Effect-TS</strong> &amp; <strong>Vue 3</strong></p>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.navbar-header {
  position: sticky;
  top: 0;
  z-index: 1000;
  border-radius: 0 0 20px 20px;
  border-top: none;
  border-left: none;
  border-right: none;
  background: rgba(11, 15, 25, 0.85);
  box-shadow: 0 4px 30px rgba(0, 0, 0, 0.4);
}

.header-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 16px 24px 12px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-icon {
  font-size: 2rem;
  background: rgba(139, 92, 246, 0.15);
  border: 1px solid rgba(139, 92, 246, 0.3);
  padding: 6px;
  border-radius: 12px;
}

.brand-info h1 {
  font-size: 1.6rem;
  margin: 0;
  line-height: 1.1;
}

.tagline {
  font-size: 0.8rem;
  color: var(--text-muted);
  letter-spacing: 0.04em;
}

.overview-stats {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.stat-bubble {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border-color);
  padding: 4px 12px;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.bubble-label {
  font-size: 0.65rem;
  text-transform: uppercase;
  color: var(--text-muted);
  font-weight: 700;
  letter-spacing: 0.05em;
}

.bubble-val {
  font-size: 0.95rem;
  font-weight: 700;
  color: #38bdf8;
  font-family: 'JetBrains Mono', monospace;
}

.sync-time {
  font-size: 0.75rem;
  color: #a855f7;
}

.reload-btn {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-color);
  color: var(--text-muted);
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 1.1rem;
  cursor: pointer;
}

.reload-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: white;
  transform: none;
  box-shadow: none;
}

.spin-icon {
  display: inline-block;
  animation: spin 0.8s linear infinite;
}

.tabs-nav {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 24px 10px 24px;
  display: flex;
  gap: 8px;
}

.tab-link {
  background: transparent;
  border: none;
  color: var(--text-muted);
  padding: 8px 18px;
  border-radius: 8px;
  font-size: 0.95rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.tab-link:hover {
  color: white;
  background: rgba(255, 255, 255, 0.05);
  transform: none;
  box-shadow: none;
}

.tab-link.active {
  background: rgba(139, 92, 246, 0.2);
  color: #c084fc;
  border: 1px solid rgba(139, 92, 246, 0.35);
}

.tab-icon {
  font-size: 1.1rem;
}

.main-content {
  flex: 1;
  padding: 32px 24px;
}

.content-container {
  max-width: 1100px;
  margin: 0 auto;
}

.app-footer {
  margin-top: auto;
  border-top: 1px solid var(--border-color);
  background: rgba(11, 15, 25, 0.95);
  padding: 24px;
  text-align: center;
  font-size: 0.85rem;
  color: var(--text-muted);
}

.footer-container strong {
  color: var(--text-main);
}
</style>
