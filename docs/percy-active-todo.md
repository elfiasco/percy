# Percy Active Todo

This file tracks the current implementation goals so the work does not disappear into chat history.

## Current Goal

Start the Percy Enterprise foundation without disrupting the existing local roundtrip app.

## In Progress

- [x] Scaffold an isolated cloud backend under `app/cloud`.
- [x] Add organization, team, project, access request, and audit models.
- [x] Add local development store.
- [x] Add local storage abstraction.
- [x] Add smoke checks for the API.
- [x] Create scoped Git backup commit for source/docs changes.
- [x] Push backup commit to GitHub remote.
- [x] Add first AWS CDK/App Runner deployment scaffold.
- [x] Install AWS CLI locally.
- [x] Install AWS CDK CLI locally.
- [x] Install CDK Python dependencies into `percy-env`.
- [x] Validate App Runner stack with `cdk synth`.
- [x] Install Docker Desktop locally.
- [x] Authenticate local AWS CLI against `percy-dev`.

## Next

- [x] Add AWS hosting plan.
- [x] Add local AWS setup notes.
- [x] Add persistent Postgres-backed repository design.
- [x] Add document registration model.
- [x] Add job model and local job lifecycle endpoints.
- [ ] Add local job runner.
- [ ] Wire existing PPTX onboarding into cloud document jobs.
- [ ] Add frontend organization/project navigation.
- [ ] Define first Python snippet contract for Bridge elements.
- [x] Add Percy Studio canvas (Bridge element overlays, drag/resize, properties panel, mode toggle).
- [ ] Add Studio: AI assistant panel.
- [ ] Add Studio: multiplayer presence + soft element locks.
- [ ] Add Studio: personal workspace / project library UI (wire cloud API to frontend).
- [ ] Add Studio: Electron desktop wrapper with bundled Percy server.

## Open Questions

- Should initial enterprise auth use Cognito directly, or an auth broker such as WorkOS/Auth0?
- Should Percy Studio Desktop use Tauri or Electron?
- Which file format should replace pickle-backed `.percy` for external use?
- What is the first customer workflow: QBRs, board decks, sales reporting, or general report refresh?
- Do we want to use IAM Identity Center immediately, or use a temporary IAM admin access key for the first dev deploy?
