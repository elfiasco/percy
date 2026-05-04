# Percy Enterprise Architecture

Percy should be both a cloud collaboration platform and a local execution/design tool.

The enterprise architecture should assume that teams need shared projects, SSO-based permissions, hosted automation, secure Python execution, local desktop workflows, and private execution options for sensitive customer data.

## Core Runtime Layers

Percy should have five major runtime layers.

### 1. Percy Cloud / Server

Percy Cloud owns the shared control plane:

- organizations, users, teams, groups, and projects;
- authentication and SSO;
- authorization and permissions;
- project metadata;
- Bridge documents and versions;
- job orchestration;
- review and approval workflows;
- AI agent coordination;
- audit logs;
- API gateway.

Percy Cloud should be the system of record for collaboration, governance, versioning, and orchestration.

### 2. Storage Layer

Percy needs several storage systems:

- relational database for organizations, users, groups, permissions, projects, jobs, versions, approvals, and audit events;
- object storage for uploaded decks, PDFs, renders, exports, Percy bundles, thumbnails, and large artifacts;
- search/vector index for project memory, templates, components, slide semantics, and reusable examples;
- secrets manager for data credentials, API keys, and environment secrets;
- artifact registry for Python environments, worker images, and reusable components.

### 3. Execution Layer

Execution should be pluggable.

Percy should support:

- sandboxed Python workers;
- rendering workers;
- data connector workers;
- AI/security workers;
- scheduled job runners;
- optional customer-private workers;
- optional local desktop workers.

This lets Percy run hosted jobs when appropriate while also supporting private enterprise data environments and local analyst workflows.

### 4. Percy Studio Web

Percy Studio Web is the collaborative browser workspace.

It should support:

- project browsing;
- shared template and component libraries;
- canvas editing;
- Bridge element inspection;
- Python snippet and data-binding editing;
- rendered preview;
- visual diffs;
- diagnostics;
- comments and review;
- approval workflows;
- team/project administration.

### 5. Percy Studio Desktop

Percy Studio Desktop is the local/private power-user surface.

It should support:

- native file access;
- local deck/PDF/Tableau onboarding;
- local PowerPoint or Office integration where needed;
- optional local Python execution;
- offline-friendly review;
- desktop rendering helpers;
- sync with Percy Cloud when allowed.

Desktop Studio should be useful both as a standalone local tool and as a client for cloud-backed Percy projects.

## Hosting Model

Percy should support multiple deployment models over time:

1. Percy SaaS.
2. Single-tenant cloud.
3. Customer VPC workers.
4. Private/on-prem deployment for large regulated customers if necessary.

The default hosted architecture should use:

- managed containers or Kubernetes for API and workers;
- Postgres for relational data;
- S3-compatible object storage for files and artifacts;
- Redis/SQS/PubSub/Kafka-style queueing for jobs;
- containerized Python workers;
- WebSocket service for live collaboration;
- cloud secrets manager and KMS;
- logs, traces, metrics, and job replay.

## Organization And Permission Model

Percy should support hierarchical organizations, but permissions should not be hardcoded only to the tree.

The conceptual hierarchy:

```text
Organization
  Workspace / Business Unit
    Team
      Project
        Deck / Report
          Bridge Document
            Slide
              Element
```

Important objects:

- Organization
- Workspace or OrgUnit
- Team
- Group
- User
- Project
- AssetLibrary
- BridgeDocument
- Component
- DataConnection
- PythonEnvironment
- Job
- ApprovalFlow

Permission roles should include:

- org admin;
- workspace admin;
- project owner;
- editor;
- reviewer;
- viewer;
- data admin;
- environment admin;
- security/audit admin.

Permissions should support inheritance:

- organization policies apply downward;
- workspace/team permissions inherit by default;
- projects can override within policy;
- sensitive assets and data connections can require explicit grants.

## SSO And Identity

Enterprise SSO should be a first-class architecture requirement.

Percy should support:

- SAML 2.0;
- OIDC;
- SCIM provisioning;
- IdP group sync;
- domain verification;
- just-in-time user creation;
- role mapping from identity provider groups;
- mandatory SSO by domain;
- MFA delegated to the identity provider.

Example policy mappings:

- Finance Analysts can edit finance reporting projects.
- Executives can review and publish.
- Data Platform can manage data connections.
- Brand Team owns shared templates.
- External Consultants can only access specific projects.

## Python Execution Modes

Percy needs three Python execution modes.

### 1. Managed Hosted Environments

Percy hosts Python environments on the server.

Use cases:

- scheduled refreshes;
- team-shared scripts;
- reproducible report generation;
- production jobs.

Implementation:

- environments are defined by `requirements.txt`, `pyproject.toml`, `conda-lock`, or an equivalent manifest;
- environments are built into container images;
- images are cached by hash;
- jobs run in sandboxed workers;
- CPU, memory, time, filesystem, and network access are limited;
- secrets are mounted only when explicitly allowed;
- outputs are captured as structured data and artifacts.

This is the enterprise reliable mode.

### 2. Customer-Private Workers

Percy Cloud orchestrates jobs, but execution runs inside customer infrastructure.

Use cases:

- sensitive data warehouses;
- regulated customers;
- no data egress policies;
- private Python packages;
- private APIs.

Implementation:

- customer installs a Percy Worker Agent;
- worker registers to Percy Cloud;
- jobs are pulled by the worker, not pushed into the customer network;
- secrets remain in the customer environment;
- policies control what artifacts can leave the customer network;
- outputs can be redacted, summarized, or limited to final approved artifacts.

This is likely important for enterprise adoption.

### 3. Local Desktop Python

Percy Studio Desktop can use Python on the user's device.

Use cases:

- analyst experimentation;
- local files;
- private prototypes;
- offline work;
- existing notebooks and Conda environments.

Implementation:

- user selects a local Python interpreter or Conda environment;
- snippets run locally with explicit trust prompts;
- Percy captures environment metadata;
- outputs are marked as local or unverified until reproduced in a managed/server environment;
- snippets can be promoted to managed environments once dependencies are declared.

Local Python is for exploration. Managed/server Python is for reproducible team workflows.

## Percy Project Package

Percy projects should have a durable package structure.

Conceptual shape:

```text
project.percyproj/
  manifest.json
  bridge/
    documents/
    components/
    schemas/
  scripts/
    refresh_revenue.py
    qbr_helpers.py
  environments/
    default.lock
  assets/
    images/
    fonts/
    templates/
  bindings/
    data_connections.json
  tests/
    visual_expectations.json
  memory/
    semantic_index.json
```

In the cloud, this can be represented by database rows plus object storage. In desktop, it can sync as a project folder or bundle.

## Multiplayer Collaboration

Canvas state should be represented as structured Bridge operations, not binary PPTX edits.

Percy should eventually support true multiplayer collaboration with CRDT or operational transform semantics. Early versions can use a simpler model:

- live presence;
- element-level soft locks;
- autosaved structured operations;
- manual version checkpoints;
- comments and review threads;
- approval flows.

Comments, reviews, and approvals should attach to Bridge elements, slides, documents, and project versions.

Every meaningful operation should write to an event log. Major versions should snapshot the full project state.

## Security Model For Python And AI

Python security requirements:

- sandboxed containers;
- no default internet access;
- explicit data connection grants;
- explicit secret grants;
- dependency allow/block lists;
- package scanning;
- execution logs;
- signed or promoted scripts for production jobs;
- approval before scheduled jobs run against sensitive data.

AI security requirements:

- tool permissions;
- prompt-injection scanning;
- strict separation of trusted instructions from document content;
- uploaded deck text must never become privileged system instructions;
- provenance for generated changes;
- human approval gates;
- agent action logs;
- per-project and per-user tool restrictions.

AI-powered security should inspect project content, code snippets, data bindings, uploaded files, prompts, and agent actions for suspicious behavior. But AI checks supplement deterministic controls; they do not replace sandboxing, policy enforcement, and auditability.

## Practical V1 Architecture

For the first enterprise-ready version, Percy should target:

- Postgres;
- S3-compatible object storage;
- FastAPI backend;
- React web Studio;
- Electron or Tauri desktop Studio;
- Redis or cloud queue initially;
- Python worker containers;
- Windows rendering worker for PowerPoint-dependent rendering;
- OIDC first, SAML soon after;
- basic organization/team/project RBAC;
- managed Python environments with pinned dependencies;
- local desktop Python marked experimental;
- object-level audit log.

The org/team permission model should be designed for hierarchy and inheritance, but should avoid overbuilding before real customers shape the details.

## Key Architectural Principle

Percy Cloud owns identity, collaboration, versioning, governance, and orchestration.

Execution is pluggable:

- Percy-hosted workers;
- customer-private workers;
- local desktop workers.

This gives Percy enterprise trust without losing the power of local Python, desktop workflows, and customer-controlled data execution.

