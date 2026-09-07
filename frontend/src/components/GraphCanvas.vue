<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import type { EdgeResult } from '../types/api';

interface GraphNode {
  id: string;
  name?: string;
  type?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  isCenter?: boolean;
}

interface GraphLink {
  source: string;
  target: string;
  relationType: string;
  confidence: number;
}

const props = defineProps<{
  entityIds: string[];
  edges: EdgeResult[];
  centerEntityId?: string;
  height?: number;
}>();

const emit = defineEmits<{
  (e: 'select-node', id: string): void;
  (e: 'select-edge', edge: EdgeResult): void;
}>();

const svgRef = ref<SVGSVGElement | null>(null);
const nodes = ref<GraphNode[]>([]);
const links = ref<GraphLink[]>([]);

// Pan and Zoom state
const pan = ref({ x: 0, y: 0 });
const zoom = ref(1);
const isPanning = ref(false);
const panStart = ref({ x: 0, y: 0 });

// Dragging node state
const draggedNode = ref<GraphNode | null>(null);

// Hover state
const hoveredNodeId = ref<string | null>(null);
const hoveredEdge = ref<EdgeResult | null>(null);

let animationFrameId: number | null = null;

// Color mapping by entity id/type
function getNodeColor(id: string, isCenter?: boolean): string {
  if (isCenter) return '#8b5cf6'; // Violet glow for central node
  const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const palette = ['#06b6d4', '#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#14b8a6'];
  return palette[hash % palette.length];
}

function initGraph() {
  const width = 800;
  const height = props.height || 500;
  const centerId = props.centerEntityId;

  // Initialize nodes
  const nodeMap = new Map<string, GraphNode>();
  const idList = Array.from(new Set([...props.entityIds, ...props.edges.map(e => e.sourceId), ...props.edges.map(e => e.targetId)]));

  idList.forEach((id, index) => {
    const isCenter = id === centerId;
    // Arrange in a circle initially
    const angle = (index / Math.max(1, idList.length)) * 2 * Math.PI;
    const radius = isCenter ? 0 : 180 + (index % 2) * 50;
    nodeMap.set(id, {
      id,
      name: id,
      x: width / 2 + Math.cos(angle) * radius,
      y: height / 2 + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      isCenter,
    });
  });

  nodes.value = Array.from(nodeMap.values());

  // Initialize links
  links.value = props.edges.map(edge => ({
    source: edge.sourceId,
    target: edge.targetId,
    relationType: edge.relationType,
    confidence: edge.confidence,
  }));

  // Run initial simulation
  runSimulation();
}

function runSimulation() {
  const width = 800;
  const height = props.height || 500;
  const centerX = width / 2;
  const centerY = height / 2;

  let iterations = 0;
  const maxIterations = 80;

  function step() {
    if (iterations >= maxIterations) {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      return;
    }

    // Node repulsion
    for (let i = 0; i < nodes.value.length; i++) {
      for (let j = i + 1; j < nodes.value.length; j++) {
        const n1 = nodes.value[i];
        const n2 = nodes.value[j];
        const dx = n2.x - n1.x;
        const dy = n2.y - n1.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist < 220) {
          const force = (220 - dist) / dist * 0.8;
          n1.vx -= dx * force * 0.1;
          n1.vy -= dy * force * 0.1;
          n2.vx += dx * force * 0.1;
          n2.vy += dy * force * 0.1;
        }
      }
    }

    // Link attraction
    const nodeById = new Map(nodes.value.map(n => [n.id, n]));
    links.value.forEach(link => {
      const source = nodeById.get(link.source);
      const target = nodeById.get(link.target);
      if (source && target) {
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const targetDist = 140;
        const force = (dist - targetDist) * 0.04;
        source.vx += (dx / dist) * force;
        source.vy += (dy / dist) * force;
        target.vx -= (dx / dist) * force;
        target.vy -= (dy / dist) * force;
      }
    });

    // Center gravity & dampening
    nodes.value.forEach(node => {
      if (node.isCenter) {
        node.vx += (centerX - node.x) * 0.15;
        node.vy += (centerY - node.y) * 0.15;
      } else {
        node.vx += (centerX - node.x) * 0.01;
        node.vy += (centerY - node.y) * 0.01;
      }
      node.vx *= 0.7;
      node.vy *= 0.7;
      if (node !== draggedNode.value) {
        node.x += node.vx;
        node.y += node.vy;
      }
    });

    iterations++;
    animationFrameId = requestAnimationFrame(step);
  }

  step();
}

// Watch changes in props
watch(() => [props.entityIds, props.edges, props.centerEntityId], () => {
  initGraph();
}, { deep: true });

onMounted(() => {
  initGraph();
});

onUnmounted(() => {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
});

// Coordinate lookups
const nodePositionMap = computed(() => {
  const map = new Map<string, { x: number; y: number }>();
  nodes.value.forEach(n => map.set(n.id, { x: n.x, y: n.y }));
  return map;
});

// Pan / Zoom handlers
function startPan(e: MouseEvent) {
  if ((e.target as HTMLElement).tagName === 'svg' || (e.target as HTMLElement).tagName === 'g') {
    isPanning.value = true;
    panStart.value = { x: e.clientX - pan.value.x, y: e.clientY - pan.value.y };
  }
}

function onMouseMove(e: MouseEvent) {
  if (isPanning.value) {
    pan.value = {
      x: e.clientX - panStart.value.x,
      y: e.clientY - panStart.value.y,
    };
  } else if (draggedNode.value) {
    // Inverse transform
    const rect = svgRef.value?.getBoundingClientRect();
    if (rect) {
      const mouseX = (e.clientX - rect.left - pan.value.x) / zoom.value;
      const mouseY = (e.clientY - rect.top - pan.value.y) / zoom.value;
      draggedNode.value.x = mouseX;
      draggedNode.value.y = mouseY;
    }
  }
}

function endPan() {
  isPanning.value = false;
  draggedNode.value = null;
}

function onWheel(e: WheelEvent) {
  e.preventDefault();
  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  zoom.value = Math.min(Math.max(zoom.value * delta, 0.4), 3.0);
}

function zoomIn() {
  zoom.value = Math.min(zoom.value * 1.2, 3.0);
}

function zoomOut() {
  zoom.value = Math.max(zoom.value * 0.8, 0.4);
}

function resetZoom() {
  pan.value = { x: 0, y: 0 };
  zoom.value = 1;
}

function startDragNode(node: GraphNode, e: MouseEvent) {
  e.stopPropagation();
  draggedNode.value = node;
}

function onNodeClick(node: GraphNode, e: MouseEvent) {
  e.stopPropagation();
  emit('select-node', node.id);
}
</script>

<template>
  <div class="graph-container">
    <div class="graph-toolbar">
      <button class="tool-btn" @click="zoomIn" title="Zoom In">➕</button>
      <button class="tool-btn" @click="zoomOut" title="Zoom Out">➖</button>
      <button class="tool-btn" @click="resetZoom" title="Reset View">🎯</button>
      <span class="zoom-level">{{ Math.round(zoom * 100) }}%</span>
    </div>

    <svg
      ref="svgRef"
      class="graph-svg"
      :style="{ height: `${height || 500}px` }"
      @mousedown="startPan"
      @mousemove="onMouseMove"
      @mouseup="endPan"
      @mouseleave="endPan"
      @wheel="onWheel"
    >
      <defs>
        <!-- Arrowhead Marker -->
        <marker
          id="arrowhead"
          viewBox="0 -5 10 10"
          refX="22"
          refY="0"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M0,-5L10,0L0,5" fill="#64748b" />
        </marker>
        <marker
          id="arrowhead-active"
          viewBox="0 -5 10 10"
          refX="22"
          refY="0"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0,-5L10,0L0,5" fill="#8b5cf6" />
        </marker>
      </defs>

      <g :transform="`translate(${pan.x}, ${pan.y}) scale(${zoom})`">
        <!-- Links -->
        <g class="links-layer">
          <g v-for="(link, i) in links" :key="`link-${i}`" class="link-group">
            <template v-if="nodePositionMap.get(link.source) && nodePositionMap.get(link.target)">
              <line
                :x1="nodePositionMap.get(link.source)!.x"
                :y1="nodePositionMap.get(link.source)!.y"
                :x2="nodePositionMap.get(link.target)!.x"
                :y2="nodePositionMap.get(link.target)!.y"
                class="link-line"
                marker-end="url(#arrowhead)"
              />
              <!-- Midpoint relation label -->
              <text
                :x="(nodePositionMap.get(link.source)!.x + nodePositionMap.get(link.target)!.x) / 2"
                :y="(nodePositionMap.get(link.source)!.y + nodePositionMap.get(link.target)!.y) / 2 - 6"
                class="link-label"
              >
                {{ link.relationType }}
              </text>
            </template>
          </g>
        </g>

        <!-- Nodes -->
        <g class="nodes-layer">
          <g
            v-for="node in nodes"
            :key="node.id"
            :transform="`translate(${node.x}, ${node.y})`"
            class="node-group"
            :class="{ 'center-node': node.isCenter, 'hovered-node': hoveredNodeId === node.id }"
            @mousedown="startDragNode(node, $event)"
            @click="onNodeClick(node, $event)"
            @mouseenter="hoveredNodeId = node.id"
            @mouseleave="hoveredNodeId = null"
          >
            <!-- Outer Glow -->
            <circle
              :r="node.isCenter ? 26 : 20"
              :fill="getNodeColor(node.id, node.isCenter)"
              opacity="0.2"
              class="node-halo"
            />
            <!-- Node Circle -->
            <circle
              :r="node.isCenter ? 18 : 14"
              :fill="getNodeColor(node.id, node.isCenter)"
              :stroke="node.isCenter ? '#c084fc' : '#ffffff'"
              :stroke-width="node.isCenter ? 3 : 1.5"
              class="node-circle"
            />
            <!-- Node Label -->
            <text
              y="28"
              class="node-label"
            >
              {{ node.id.length > 20 ? node.id.slice(0, 18) + '…' : node.id }}
            </text>
          </g>
        </g>
      </g>
    </svg>

    <div v-if="nodes.length === 0" class="empty-graph-state">
      <span class="empty-icon">🕸️</span>
      <p>No graph nodes or edges to display</p>
    </div>
  </div>
</template>

<style scoped>
.graph-container {
  position: relative;
  width: 100%;
  background: radial-gradient(circle at center, rgba(30, 41, 59, 0.4) 0%, rgba(15, 23, 42, 0.7) 100%);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  overflow: hidden;
}

.graph-toolbar {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(15, 23, 42, 0.8);
  backdrop-filter: blur(8px);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 4px 8px;
  z-index: 10;
}

.tool-btn {
  background: transparent;
  border: none;
  color: var(--text-main);
  padding: 4px 8px;
  font-size: 0.85rem;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s;
}

.tool-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  transform: none;
  box-shadow: none;
}

.zoom-level {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-family: monospace;
  padding-left: 4px;
}

.graph-svg {
  width: 100%;
  display: block;
  cursor: grab;
  user-select: none;
}

.graph-svg:active {
  cursor: grabbing;
}

.link-line {
  stroke: rgba(148, 163, 184, 0.35);
  stroke-width: 1.5;
  transition: stroke 0.2s;
}

.link-group:hover .link-line {
  stroke: #a855f7;
  stroke-width: 2.5;
}

.link-label {
  font-size: 10px;
  fill: #94a3b8;
  text-anchor: middle;
  font-family: monospace;
  pointer-events: none;
}

.node-group {
  cursor: pointer;
  transition: transform 0.15s ease-out;
}

.node-group:hover .node-halo {
  opacity: 0.4;
  transform: scale(1.2);
}

.node-label {
  font-size: 11px;
  fill: #e2e8f0;
  text-anchor: middle;
  font-weight: 500;
  pointer-events: none;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
}

.center-node .node-label {
  fill: #c084fc;
  font-weight: 700;
  font-size: 12px;
}

.empty-graph-state {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  color: var(--text-muted);
}

.empty-icon {
  font-size: 2.5rem;
  margin-bottom: 8px;
  display: block;
}
</style>
