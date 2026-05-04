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

## Next

- [ ] Add persistent Postgres-backed repository design.
- [ ] Add document registration model.
- [ ] Add job model and local job runner.
- [ ] Wire existing PPTX onboarding into cloud document jobs.
- [ ] Add frontend organization/project navigation.
- [ ] Define first Python snippet contract for Bridge elements.

## Open Questions

- Should initial enterprise auth use Cognito directly, or an auth broker such as WorkOS/Auth0?
- Should Percy Studio Desktop use Tauri or Electron?
- Which file format should replace pickle-backed `.percy` for external use?
- What is the first customer workflow: QBRs, board decks, sales reporting, or general report refresh?
