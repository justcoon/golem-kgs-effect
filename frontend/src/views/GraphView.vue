<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { ApiService } from '../services/api';
import GraphCanvas from '../components/GraphCanvas.vue';
import type { EdgeResult, EntityResult, PathFindingResult } from '../types/api';

const props = defineProps<{
  initialEntityId?: string | null;
}>();

const emit = defineEmits<{
  (e: 'inspect-entity', entityId: string): void;
}>();

const mode = ref<'neighborhood' | 'paths'>('neighborhood');

// Neighborhood state
const targetEntityId = ref('');
const maxDepth = ref(2);
const minConfidence = ref<number | undefined>(undefined);
const neighborhoodLoading = ref(false);
const neighborhoodError = ref<string | null>(null);
const graphEntities = ref<EntityResult[]>([]);
const graphEdges = ref<EdgeResult[]>([]);
const activeCenterId = ref<string | undefined>(undefined);

// Entity lookup map
const entityMap = computed(() => new Map<string, EntityResult>(graphEntities.value.map(e => [e.id, e])));

// Autocomplete state
const targetSuggestions = ref<EntityResult[]>([]);
const sourceSuggestions = ref<EntityResult[]>([]);
const destSuggestions = ref<EntityResult[]>([]);
const showTargetSuggestions = ref(false);
const showSourceSuggestions = ref(false);
const showDestSuggestions = ref(false);

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function onInputSearch(field: 'target' | 'source' | 'dest') {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    const q = (
      field === 'target'
        ? targetEntityId.value
        : field === 'source'
          ? sourceEntityId.value
          : destEntityId.value
    ).trim();

    if (q.length < 2) {
      if (field === 'target') targetSuggestions.value = [];
      if (field === 'source') sourceSuggestions.value = [];
      if (field === 'dest') destSuggestions.value = [];
      return;
    }

    try {
      const results = await ApiService.searchEntities(q, 6);
      if (field === 'target') {
        targetSuggestions.value = results;
        showTargetSuggestions.value = results.length > 0;
      } else if (field === 'source') {
        sourceSuggestions.value = results;
        showSourceSuggestions.value = results.length > 0;
      } else {
        destSuggestions.value = results;
        showDestSuggestions.value = results.length > 0;
      }
    } catch {
      // ignore
    }
  }, 250);
}

function selectSuggestion(field: 'target' | 'source' | 'dest', entity: EntityResult) {
  if (field === 'target') {
    targetEntityId.value = entity.name;
    showTargetSuggestions.value = false;
    handleExploreNeighborhood(entity.id);
  } else if (field === 'source') {
    sourceEntityId.value = entity.name;
    showSourceSuggestions.value = false;
  } else {
    destEntityId.value = entity.name;
    showDestSuggestions.value = false;
  }
}

// Path finding state
const sourceEntityId = ref('');
const destEntityId = ref('');
const pathMaxDepth = ref(4);
const pathDirection = ref<'BOTH' | 'OUTBOUND' | 'INBOUND'>('BOTH');
const pathLoading = ref(false);
const pathError = ref<string | null>(null);
const pathResults = ref<PathFindingResult | null>(null);

// Quick select top connected entities (hubs)
const quickSelectEntities = ref<EntityResult[]>([]);
const quickSelectLoading = ref(false);

async function loadQuickSelectEntities() {
  quickSelectLoading.value = true;
  try {
    const hubs = await ApiService.getTopEntities(8);
    quickSelectEntities.value = hubs;
  } catch {
    quickSelectEntities.value = [];
  } finally {
    quickSelectLoading.value = false;
  }
}

onMounted(() => {
  loadQuickSelectEntities();
});

function onFocusSearch(field: 'target' | 'source' | 'dest') {
  const currentVal = (
    field === 'target'
      ? targetEntityId.value
      : field === 'source'
        ? sourceEntityId.value
        : destEntityId.value
  ).trim();

  if (currentVal.length === 0 && quickSelectEntities.value.length > 0) {
    if (field === 'target') {
      targetSuggestions.value = quickSelectEntities.value.slice(0, 6);
      showTargetSuggestions.value = true;
    } else if (field === 'source') {
      sourceSuggestions.value = quickSelectEntities.value.slice(0, 6);
      showSourceSuggestions.value = true;
    } else {
      destSuggestions.value = quickSelectEntities.value.slice(0, 6);
      showDestSuggestions.value = true;
    }
  } else if (
    (field === 'target' && targetSuggestions.value.length > 0) ||
    (field === 'source' && sourceSuggestions.value.length > 0) ||
    (field === 'dest' && destSuggestions.value.length > 0)
  ) {
    if (field === 'target') showTargetSuggestions.value = true;
    if (field === 'source') showSourceSuggestions.value = true;
    if (field === 'dest') showDestSuggestions.value = true;
  }
}

function onBlurSearch(field: 'target' | 'source' | 'dest') {
  setTimeout(() => {
    if (field === 'target') showTargetSuggestions.value = false;
    if (field === 'source') showSourceSuggestions.value = false;
    if (field === 'dest') showDestSuggestions.value = false;
  }, 200);
}

function handleQuickSelectPath(name: string) {
  if (!sourceEntityId.value.trim()) {
    sourceEntityId.value = name;
  } else if (!destEntityId.value.trim()) {
    destEntityId.value = name;
  } else {
    destEntityId.value = name;
  }
}

async function handleExploreNeighborhood(entityToExplore?: string) {
  const id = (entityToExplore || targetEntityId.value).trim();
  if (!id) return;

  targetEntityId.value = id;
  neighborhoodLoading.value = true;
  neighborhoodError.value = null;

  try {
    const res = await ApiService.getNeighborhood(id, {
      maxDepth: maxDepth.value,
      minConfidence: minConfidence.value,
    });
    graphEntities.value = res.entities || [];
    graphEdges.value = res.edges;
    activeCenterId.value = id;
  } catch (err: any) {
    neighborhoodError.value = err.message || 'Failed to traverse neighborhood.';
  } finally {
    neighborhoodLoading.value = false;
  }
}

async function handleFindPaths() {
  const src = sourceEntityId.value.trim();
  const tgt = destEntityId.value.trim();
  if (!src || !tgt) return;

  pathLoading.value = true;
  pathError.value = null;
  pathResults.value = null;

  try {
    const res = await ApiService.findPaths(src, tgt, {
      maxDepth: pathMaxDepth.value,
      direction: pathDirection.value,
    });
    pathResults.value = res;

    // Build unified graph representation for all path nodes & edges
    const allEdges: EdgeResult[] = [];
    const edgeKeySet = new Set<string>();

    res.paths.forEach(p => {
      p.edges.forEach(e => {
        const k = `${e.sourceId}->${e.relationType}->${e.targetId}`;
        if (!edgeKeySet.has(k)) {
          edgeKeySet.add(k);
          allEdges.push(e);
        }
      });
    });

    graphEntities.value = res.entities || [];
    graphEdges.value = allEdges;
    activeCenterId.value = src;
  } catch (err: any) {
    pathError.value = err.message || 'Failed to calculate entity paths.';
  } finally {
    pathLoading.value = false;
  }
}

function handleNodeSelect(id: string) {
  emit('inspect-entity', id);
}

// Watch initialEntityId passed from external interactions
watch(() => props.initialEntityId, (newId) => {
  if (newId) {
    mode.value = 'neighborhood';
    targetEntityId.value = newId;
    handleExploreNeighborhood(newId);
  }
}, { immediate: true });
</script>

<template>
  <div class="graph-view animate-fade-in">
    <!-- Graph Navigation Tabs -->
    <div class="graph-nav glass">
      <div class="mode-tabs">
        <button
          class="tab-btn"
          :class="{ active: mode === 'neighborhood' }"
          @click="mode = 'neighborhood'"
        >
          🕸️ Entity Neighborhood
        </button>
        <button
          class="tab-btn"
          :class="{ active: mode === 'paths' }"
          @click="mode = 'paths'"
        >
          🛤️ Multi-Hop Path Finder
        </button>
      </div>
    </div>

    <!-- Neighborhood Controls -->
    <div v-if="mode === 'neighborhood'" class="controls-card glass">
      <div class="query-row">
        <div class="autocomplete-wrapper">
          <input
            v-model="targetEntityId"
            type="text"
            placeholder="Enter entity name or ID (e.g. 'PostgreSQL')..."
            class="entity-input"
            @input="onInputSearch('target')"
            @focus="onFocusSearch('target')"
            @blur="onBlurSearch('target')"
            @keyup.enter="handleExploreNeighborhood()"
          />
          <div v-if="showTargetSuggestions && targetSuggestions.length > 0" class="suggestions-dropdown glass">
            <div
              v-for="item in targetSuggestions"
              :key="item.id"
              class="suggestion-item"
              @mousedown.prevent="selectSuggestion('target', item)"
            >
              <div class="suggestion-main">
                <span class="suggestion-name">{{ item.name }}</span>
                <span class="type-pill" :class="item.entityType.toLowerCase()">{{ item.entityType }}</span>
              </div>
              <div v-if="item.description" class="suggestion-desc">{{ item.description }}</div>
            </div>
          </div>
        </div>
        <button
          class="explore-btn"
          :disabled="neighborhoodLoading || !targetEntityId.trim()"
          @click="handleExploreNeighborhood()"
        >
          <span v-if="neighborhoodLoading" class="spinner"></span>
          <span v-else>Explore</span>
        </button>
      </div>

      <div class="options-row">
        <div class="option-item">
          <label>Max Depth (Hops):</label>
          <select v-model.number="maxDepth" class="pill-select">
            <option :value="1">1 Hop</option>
            <option :value="2">2 Hops</option>
            <option :value="3">3 Hops</option>
          </select>
        </div>

        <div class="sample-chips">
          <span class="chip-label">Top Hubs:</span>
          <span v-if="quickSelectLoading" class="chip-loading">Loading hubs...</span>
          <template v-else-if="quickSelectEntities.length > 0">
            <button
              v-for="entity in quickSelectEntities"
              :key="entity.id"
              class="chip-btn"
              :class="entity.entityType.toLowerCase()"
              :title="`${entity.name} (${entity.entityType})`"
              @click="handleExploreNeighborhood(entity.name)"
            >
              <span class="chip-dot"></span>
              {{ entity.name }}
            </button>
          </template>
          <span v-else class="chip-empty">No entities indexed yet</span>
        </div>
      </div>
    </div>

    <!-- Path Finder Controls -->
    <div v-if="mode === 'paths'" class="controls-card glass">
      <div class="path-inputs-row">
        <div class="input-field">
          <label>Source Entity</label>
          <div class="autocomplete-wrapper">
            <input
              v-model="sourceEntityId"
              type="text"
              placeholder="Starting entity..."
              class="entity-input"
              @input="onInputSearch('source')"
              @focus="onFocusSearch('source')"
              @blur="onBlurSearch('source')"
            />
            <div v-if="showSourceSuggestions && sourceSuggestions.length > 0" class="suggestions-dropdown glass">
              <div
                v-for="item in sourceSuggestions"
                :key="item.id"
                class="suggestion-item"
                @mousedown.prevent="selectSuggestion('source', item)"
              >
                <div class="suggestion-main">
                  <span class="suggestion-name">{{ item.name }}</span>
                  <span class="type-pill" :class="item.entityType.toLowerCase()">{{ item.entityType }}</span>
                </div>
                <div v-if="item.description" class="suggestion-desc">{{ item.description }}</div>
              </div>
            </div>
          </div>
        </div>
        <span class="arrow-indicator">➔</span>
        <div class="input-field">
          <label>Target Entity</label>
          <div class="autocomplete-wrapper">
            <input
              v-model="destEntityId"
              type="text"
              placeholder="Destination entity..."
              class="entity-input"
              @input="onInputSearch('dest')"
              @focus="onFocusSearch('dest')"
              @blur="onBlurSearch('dest')"
            />
            <div v-if="showDestSuggestions && destSuggestions.length > 0" class="suggestions-dropdown glass">
              <div
                v-for="item in destSuggestions"
                :key="item.id"
                class="suggestion-item"
                @mousedown.prevent="selectSuggestion('dest', item)"
              >
                <div class="suggestion-main">
                  <span class="suggestion-name">{{ item.name }}</span>
                  <span class="type-pill" :class="item.entityType.toLowerCase()">{{ item.entityType }}</span>
                </div>
                <div v-if="item.description" class="suggestion-desc">{{ item.description }}</div>
              </div>
            </div>
          </div>
        </div>
        <button
          class="explore-btn"
          :disabled="pathLoading || !sourceEntityId.trim() || !destEntityId.trim()"
          @click="handleFindPaths()"
        >
          <span v-if="pathLoading" class="spinner"></span>
          <span v-else>Find Paths</span>
        </button>
      </div>

      <div class="options-row">
        <div class="option-item">
          <label>Max Depth:</label>
          <select v-model.number="pathMaxDepth" class="pill-select">
            <option :value="2">2 Hops</option>
            <option :value="3">3 Hops</option>
            <option :value="4">4 Hops</option>
            <option :value="5">5 Hops</option>
          </select>
        </div>
        <div class="option-item">
          <label>Direction:</label>
          <select v-model="pathDirection" class="pill-select">
            <option value="BOTH">Bidirectional</option>
            <option value="OUTBOUND">Outbound Only</option>
            <option value="INBOUND">Inbound Only</option>
          </select>
        </div>

        <div v-if="quickSelectEntities.length > 0" class="sample-chips">
          <span class="chip-label">Quick select:</span>
          <button
            v-for="entity in quickSelectEntities"
            :key="entity.id"
            class="chip-btn"
            :class="entity.entityType.toLowerCase()"
            :title="`Click to fill: ${entity.name}`"
            @click="handleQuickSelectPath(entity.name)"
          >
            <span class="chip-dot"></span>
            {{ entity.name }}
          </button>
        </div>
      </div>
    </div>

    <!-- Error Banners -->
    <div v-if="neighborhoodError" class="error-banner glass animate-fade-in">
      <span>⚠️ {{ neighborhoodError }}</span>
    </div>
    <div v-if="pathError" class="error-banner glass animate-fade-in">
      <span>⚠️ {{ pathError }}</span>
    </div>

    <!-- Graph Visualization Canvas -->
    <div class="visualization-wrapper">
      <div v-if="graphEntities.length > 0" class="graph-stats-bar">
        <span class="stat-pill">
          Entities: <strong>{{ graphEntities.length }}</strong>
        </span>
        <span class="stat-pill">
          Relationships: <strong>{{ graphEdges.length }}</strong>
        </span>
        <span v-if="activeCenterId" class="stat-pill highlight">
          Focus: <strong>{{ entityMap.get(activeCenterId)?.name || activeCenterId }}</strong>
        </span>
        <span class="hint-text">Tip: Drag nodes to arrange, scroll to zoom, click node to inspect.</span>
      </div>

      <GraphCanvas
        :entities="graphEntities"
        :edges="graphEdges"
        :center-entity-id="activeCenterId"
        :height="520"
        @select-node="handleNodeSelect"
      />
    </div>

    <!-- Path Chain Breakdown Section (Path Mode) -->
    <div v-if="mode === 'paths' && pathResults && pathResults.paths.length > 0" class="paths-breakdown glass animate-fade-in">
      <div class="breakdown-header">
        <h4>Discovered Relational Chains ({{ pathResults.paths.length }})</h4>
        <span v-if="pathResults.shortestPathLength !== null" class="shortest-badge">
          Shortest: {{ pathResults.shortestPathLength }} hops
        </span>
      </div>

      <div class="paths-list">
        <div
          v-for="(path, idx) in pathResults.paths"
          :key="idx"
          class="path-card"
        >
          <div class="path-card-top">
            <span class="path-number">Path #{{ idx + 1 }}</span>
            <span class="path-weight">Total Weight: {{ path.totalWeight.toFixed(2) }}</span>
          </div>

          <div class="path-chain">
            <template v-for="(entityId, eIdx) in path.entityIds" :key="eIdx">
              <button class="node-chip" @click="emit('inspect-entity', entityId)">
                {{ entityMap.get(entityId)?.name || entityId }}
              </button>
              <span v-if="eIdx < path.edges.length" class="edge-segment">
                <span class="edge-rel-text">{{ path.edges[eIdx].relationType }}</span>
                <span class="edge-arrow">➔</span>
              </span>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- Relationships Table (Neighborhood Mode) -->
    <div v-if="mode === 'neighborhood' && graphEdges.length > 0" class="edges-table-card glass animate-fade-in">
      <h4 class="table-title">Traversed Relationships</h4>
      <div class="table-scroll">
        <table class="edges-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Relation</th>
              <th>Target</th>
              <th>Confidence</th>
              <th>Weight</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="edge in graphEdges"
              :key="`${edge.sourceId}-${edge.relationType}-${edge.targetId}`"
            >
              <td>
                <button class="table-link-btn" @click="emit('inspect-entity', edge.sourceId)">
                  {{ entityMap.get(edge.sourceId)?.name || edge.sourceId }}
                </button>
              </td>
              <td>
                <span class="rel-badge">{{ edge.relationType }}</span>
              </td>
              <td>
                <button class="table-link-btn" @click="emit('inspect-entity', edge.targetId)">
                  {{ entityMap.get(edge.targetId)?.name || edge.targetId }}
                </button>
              </td>
              <td>{{ (edge.confidence * 100).toFixed(0) }}%</td>
              <td>{{ edge.weight.toFixed(2) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.graph-view {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.graph-nav {
  padding: 8px;
  display: flex;
  justify-content: center;
}

.mode-tabs {
  display: flex;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 4px;
  gap: 6px;
}

.tab-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  padding: 8px 18px;
  border-radius: 8px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.tab-btn:hover {
  color: white;
  transform: none;
  box-shadow: none;
}

.tab-btn.active {
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.3), rgba(59, 130, 246, 0.3));
  border: 1px solid rgba(139, 92, 246, 0.4);
  color: #c084fc;
}

.controls-card {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.query-row {
  display: flex;
  gap: 12px;
}

.entity-input {
  flex: 1;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 10px 16px;
  color: var(--text-main);
  font-size: 0.95rem;
}

.entity-input:focus {
  border-color: var(--primary);
}

.autocomplete-wrapper {
  position: relative;
  flex: 1;
  display: flex;
}

.autocomplete-wrapper .entity-input {
  width: 100%;
}

.suggestions-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  background: rgba(15, 23, 42, 0.95);
  border: 1px solid rgba(139, 92, 246, 0.3);
  border-radius: 10px;
  overflow: hidden;
  z-index: 100;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
  max-height: 260px;
  overflow-y: auto;
}

.suggestion-item {
  padding: 10px 14px;
  cursor: pointer;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  transition: background 0.15s ease;
}

.suggestion-item:last-child {
  border-bottom: none;
}

.suggestion-item:hover {
  background: rgba(139, 92, 246, 0.15);
}

.suggestion-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.suggestion-name {
  font-weight: 600;
  color: var(--text-main);
  font-size: 0.9rem;
}

.suggestion-desc {
  font-size: 0.78rem;
  color: var(--text-muted);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.type-pill {
  font-size: 0.7rem;
  padding: 2px 8px;
  border-radius: 9999px;
  font-weight: 600;
  text-transform: uppercase;
  background: rgba(100, 116, 139, 0.2);
  color: #94a3b8;
}

.type-pill.technology {
  background: rgba(59, 130, 246, 0.2);
  color: #60a5fa;
}

.type-pill.concept {
  background: rgba(168, 85, 247, 0.2);
  color: #c084fc;
}

.type-pill.document {
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
}

.type-pill.organization {
  background: rgba(245, 158, 11, 0.2);
  color: #fbbf24;
}

.explore-btn {
  background: linear-gradient(135deg, #8b5cf6, #3b82f6);
  border: none;
  border-radius: 10px;
  padding: 10px 24px;
  color: white;
  font-weight: 600;
  font-size: 0.95rem;
  cursor: pointer;
  white-space: nowrap;
  transition: transform 0.2s, box-shadow 0.2s;
}

.explore-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(139, 92, 246, 0.4);
}

.explore-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.options-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.option-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  color: var(--text-muted);
}

.pill-select {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-color);
  color: var(--text-main);
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 0.85rem;
  outline: none;
}

.sample-chips {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.chip-label {
  font-size: 0.8rem;
  color: var(--text-muted);
}

.chip-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--text-muted);
  font-size: 0.75rem;
  padding: 3px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.chip-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #94a3b8;
  flex-shrink: 0;
}

.chip-btn.technology .chip-dot { background: #60a5fa; }
.chip-btn.concept .chip-dot { background: #c084fc; }
.chip-btn.organization .chip-dot { background: #34d399; }
.chip-btn.person .chip-dot { background: #f472b6; }
.chip-btn.document .chip-dot { background: #fbbf24; }
.chip-btn.location .chip-dot { background: #f87171; }

.chip-loading,
.chip-empty {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-style: italic;
}

.chip-btn:hover {
  background: rgba(139, 92, 246, 0.15);
  border-color: #8b5cf6;
  color: white;
  transform: none;
  box-shadow: none;
}

.path-inputs-row {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}

.input-field {
  flex: 1;
  min-width: 200px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.input-field label {
  font-size: 0.75rem;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--text-muted);
}

.arrow-indicator {
  font-size: 1.4rem;
  color: var(--text-muted);
  margin-bottom: 10px;
}

.visualization-wrapper {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.graph-stats-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 8px;
  font-size: 0.85rem;
  color: var(--text-muted);
  flex-wrap: wrap;
}

.stat-pill {
  background: rgba(255, 255, 255, 0.05);
  padding: 3px 10px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
}

.stat-pill strong {
  color: #38bdf8;
}

.stat-pill.highlight strong {
  color: #c084fc;
}

.hint-text {
  margin-left: auto;
  font-size: 0.8rem;
  color: #64748b;
  font-style: italic;
}

.paths-breakdown,
.edges-table-card {
  padding: 20px;
}

.breakdown-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.breakdown-header h4,
.table-title {
  margin: 0;
  font-size: 1.1rem;
}

.shortest-badge {
  background: rgba(16, 185, 129, 0.15);
  border: 1px solid rgba(16, 185, 129, 0.3);
  color: #34d399;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 600;
}

.paths-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.path-card {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 14px;
}

.path-card-top {
  display: flex;
  justify-content: space-between;
  font-size: 0.8rem;
  color: var(--text-muted);
  margin-bottom: 10px;
}

.path-number {
  font-weight: 700;
  color: #a855f7;
}

.path-chain {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.node-chip {
  background: rgba(139, 92, 246, 0.15);
  border: 1px solid rgba(139, 92, 246, 0.3);
  color: #f1f5f9;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
}

.node-chip:hover {
  background: rgba(139, 92, 246, 0.3);
  border-color: #c084fc;
}

.edge-segment {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #94a3b8;
  font-size: 0.75rem;
}

.edge-rel-text {
  font-family: 'JetBrains Mono', monospace;
  color: #38bdf8;
}

.table-scroll {
  overflow-x: auto;
  margin-top: 12px;
}

.edges-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  font-size: 0.85rem;
}

.edges-table th {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-muted);
  font-weight: 600;
  text-transform: uppercase;
  font-size: 0.7rem;
}

.edges-table td {
  padding: 10px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  color: #cbd5e1;
}

.table-link-btn {
  background: transparent;
  border: none;
  color: #38bdf8;
  padding: 0;
  font-size: 0.85rem;
  font-family: inherit;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.table-link-btn:hover {
  color: #7dd3fc;
  transform: none;
  box-shadow: none;
}

.rel-badge {
  background: rgba(139, 92, 246, 0.15);
  color: #c084fc;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.75rem;
  font-family: 'JetBrains Mono', monospace;
}

.error-banner {
  padding: 12px 16px;
  border-color: rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.1);
  color: #fca5a5;
  border-radius: 10px;
}
</style>
