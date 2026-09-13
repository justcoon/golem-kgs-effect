# Knowledge Graphs and Vector Storage

## Overview
A Knowledge Graph organizes information into entities and relationships, providing a structured topology of domain concepts.

## Storage Substrate with PostgreSQL and pgvector
In this architecture, PostgreSQL serves as the relational and vector storage substrate.
The pgvector extension enables efficient similarity search using HNSW indexing on high-dimensional embedding vectors.

## Semantic Traversal and Entity Resolution
Entity resolution merges multiple mentions of concepts into canonical entities using Bayesian confidence updates.
Directed relationships link entities to enable multi-hop neighborhood traversal and GraphRAG context retrieval.
