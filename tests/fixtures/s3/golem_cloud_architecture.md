# Golem Cloud Architecture and Durable Execution

## Overview of Golem Cloud
Golem Cloud is a next-generation serverless platform built on WebAssembly components and durable execution.
It allows developers to build robust, stateful applications without managing databases for agent state.

## Core Concepts
### Durable Execution
In Golem Cloud, programs execute durably. If an unexpected server failure occurs or a node crashes,
the runtime replays invocations using the recorded operation log (oplog) to restore complete memory state.

### Effect-TS Integration
The application agents in Golem KGS are implemented using TypeScript and Effect-TS.
Effect provides functional programming abstractions for resource management, typed error handling, and concurrency.

### WebAssembly Component Model
WebAssembly provides a secure, sandboxed execution environment. QuickJS executes inside the WebAssembly component,
allowing high-performance execution of JavaScript and TypeScript agents.
