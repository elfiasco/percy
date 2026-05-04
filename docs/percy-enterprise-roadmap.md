# Percy Enterprise Roadmap

This roadmap tracks the path from the current Percy prototype to an enterprise software foundation.

## Product Boundary

Percy v1 should let an organization:

- create an organization workspace;
- create teams and sub-teams;
- create projects;
- upload or register reporting artifacts;
- onboard documents into Bridge;
- review original, Bridge, rebuilt, and exported output;
- attach Python refresh logic to Bridge elements;
- run controlled jobs;
- request and approve access;
- keep an audit trail of important actions.

Percy v1 should not try to include everything at once.

Not v1:

- perfect Figma-style multiplayer canvas;
- full PowerPoint replacement;
- full Tableau roundtrip;
- unrestricted autonomous agents;
- complete SCIM/SAML enterprise admin surface;
- complex policy engine beyond practical RBAC.

## Engineering Phases

### Phase 1: Enterprise Control Plane

Build the core organization/project backend without disturbing the current roundtrip app.

Goals:

- organization model;
- team/sub-team model;
- project model;
- roles and memberships;
- access request and approval flow;
- audit events;
- local development storage;
- API shape that can later move to Postgres/AWS.

### Phase 2: Storage And Jobs

Create abstractions that allow the current local filesystem workflow to move toward AWS.

Goals:

- storage interface;
- local storage implementation;
- future S3 implementation;
- job request model;
- local worker runner;
- future SQS/ECS worker runner;
- artifact records;
- job audit trail.

### Phase 3: Bridge Integration

Plug the existing Percy engine into the enterprise control plane.

Goals:

- register uploaded PPTX/PDF/Tableau files as project documents;
- onboard documents into Bridge;
- store Bridge versions;
- rebuild/export outputs;
- render previews;
- attach diagnostics to document versions.

### Phase 4: Python Snippets

Make Bridge elements programmable in a controlled way.

Goals:

- snippet model;
- snippet ownership and permissions;
- structured input/output contract;
- local execution for development;
- managed execution contract for server workers;
- run history;
- element-level binding metadata.

### Phase 5: Studio Evolution

Turn the current local Studio into an enterprise workspace.

Goals:

- organization/project navigation;
- document library;
- access requests;
- job history;
- Bridge element inspector;
- snippet editor;
- run/test UI;
- audit trail;
- review and approval surfaces.

### Phase 6: AWS Foundation

Move the control plane to AWS-ready infrastructure.

Target stack:

- FastAPI service;
- Postgres/RDS;
- S3;
- SQS;
- ECS/Fargate workers;
- CloudWatch logs;
- Secrets Manager;
- Cognito or external enterprise auth provider;
- CloudFront for frontend delivery.

## Current Implementation Track

The first track is the enterprise control plane.

Initial build items:

- [ ] Add active todo file.
- [ ] Add cloud backend package skeleton.
- [ ] Add in-memory/local repository for development.
- [ ] Add organization creation endpoint.
- [ ] Add team and sub-team creation endpoint.
- [ ] Add project creation endpoint.
- [ ] Add access request endpoint.
- [ ] Add access approval endpoint.
- [ ] Add audit event model.
- [ ] Add local storage abstraction.
- [ ] Add smoke checks for the new API.

