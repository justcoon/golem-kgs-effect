<script setup lang="ts">
import type { EntityResult } from '../types/api';

const props = defineProps<{
  entity: EntityResult | null;
  isOpen: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'explore', entityId: string): void;
}>();
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

.action-btn.primary {
  width: 100%;
  padding: 10px 16px;
  background: linear-gradient(135deg, #8b5cf6, #3b82f6);
  border: none;
  border-radius: 8px;
  color: white;
  font-weight: 600;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

.action-btn.primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 14px rgba(139, 92, 246, 0.4);
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
}

.prop-item {
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
  padding: 4px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.prop-item:last-child {
  border-bottom: none;
}

.prop-key {
  color: var(--text-muted);
  font-family: monospace;
}

.prop-value {
  color: var(--text-main);
  font-weight: 500;
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
