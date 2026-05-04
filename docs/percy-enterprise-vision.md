# Percy Enterprise Vision

Percy should become the final boss for data visualization and reporting.

The core opportunity is not only generating PowerPoint decks. The bigger opportunity is organizing the entire lifecycle of business visual communication: data, templates, analysis, narrative, formatting, review, refresh, export, and institutional memory.

Percy should let an organization turn its existing reporting artifacts into a living system. Existing PowerPoint decks, PDFs, Tableau workbooks, screenshots, charts, tables, brand templates, and recurring reports become source material. Percy onboards those artifacts, learns their visual language, extracts reusable components, and stores them as Bridge elements that can be edited, regenerated, tested, and reused.

From there, Percy can support two major modes:

1. Reproduce, refresh, and govern existing reporting.
2. Generate new reporting and deck material from the organization's own examples, templates, data, and memory.

## Core Product Thesis

Percy is the enterprise operating layer for data visualization and reporting.

It combines:

- a structured Bridge model for business visuals;
- Python-native data and automation;
- AI-assisted generation, editing, and analysis;
- reusable organizational templates and components;
- visual QA, diffing, and approval workflows;
- collaborative Studio editing;
- secure execution and governance.

PowerPoint remains an important output, but Percy should not be limited to PowerPoint. The long-term system should treat PPTX, PDF, web reports, dashboards, and BI outputs as render targets from a richer organizational reporting model.

## Percy Studio

Percy Studio should be the main user-facing workspace.

It should exist as both:

- a web app for collaborative enterprise workflows;
- a desktop app for local/private work, heavy file handling, offline-friendly review, and native integrations.

Studio should feel like a stronger, modernized PowerPoint for structured reporting. Users should be able to manually manipulate visual elements on a canvas: move, resize, align, style, group, edit text, adjust chart/table layouts, and review rendered output. Manual control matters because business reporting needs polish and judgment.

But unlike PowerPoint, every element should also be programmable and inspectable.

Each Bridge element should be able to carry:

- formatting cues;
- layout constraints;
- data bindings;
- Python snippets or references to approved Python functions;
- refresh logic;
- provenance;
- comments and team memory;
- validation rules;
- AI-readable semantic descriptions;
- visual regression expectations.

The user should be able to edit a chart visually, attach a Python snippet that produces the chart data, run the snippet, preview the result, compare before/after output, and save the logic as part of the project.

## Multiplayer Collaboration

Percy projects should support multi-player collaboration.

Multiple people should be able to work in the same Percy project with:

- live presence;
- comments and review threads;
- element-level ownership/history;
- branch/version workflows;
- approvals;
- role-based permissions;
- reusable shared components;
- shared data connections;
- project memory.

This matters because enterprise reporting is rarely a single-player workflow. Finance, sales, data, strategy, design, operations, and executives all touch the same reporting materials.

## Template And Component Memory

Onboarding existing artifacts should jumpstart the organization.

Instead of asking a company to start with a blank Percy workspace, Percy should learn from what the company already has:

- board decks;
- investor presentations;
- QBRs;
- sales decks;
- customer reports;
- KPI reviews;
- Tableau dashboards;
- PDF reports;
- brand templates.

Percy should extract reusable patterns:

- slide layouts;
- chart styles;
- table styles;
- common callout structures;
- KPI cards;
- footers/disclaimers;
- color palettes;
- typography;
- brand rules;
- recurring data narratives.

AI-assisted generation can then use those examples to create new material that looks and feels native to the organization.

## Data And Python

Python is central to Percy.

The reporting layer should connect naturally to:

- pandas;
- SQL;
- data warehouses;
- spreadsheets;
- APIs;
- notebooks;
- scheduled pipelines;
- internal analytics packages;
- ML and AI workflows.

A Percy project should make it easy to attach Python to reporting elements, run snippets safely, inspect outputs, and preserve the relationship between data and final visual output.

The end state is that a deck is no longer a stale manual artifact. It becomes a rendered result of data, code, templates, and human-reviewed narrative.

## AI Role

AI should operate on Percy through structured Bridge elements, not only screenshots or raw Office XML.

Useful AI workflows include:

- generate a new deck from a prompt, data, and approved company examples;
- update a recurring report with current data;
- summarize changes from the prior version;
- identify stale or inconsistent metrics;
- suggest visual improvements;
- convert a dashboard into an executive narrative;
- standardize decks to brand rules;
- extract reusable components from uploaded decks;
- explain what a slide is doing and what data drives it;
- propose Python snippets for data refresh;
- detect suspicious instructions, unsafe data access, and prompt injection attempts.

AI should assist, but the system must remain auditable, testable, and controllable.

## Security And Trust

Percy will handle sensitive business documents, data connections, Python code, and AI interactions. Security must be core to the product, not a later add-on.

Key requirements:

- safe, versioned Bridge serialization;
- sandboxed Python execution;
- restricted network and filesystem access;
- secret isolation;
- tenant isolation;
- role-based permissions;
- audit logs;
- review gates before publishing;
- data retention controls;
- malware/file scanning;
- prompt-injection detection;
- AI tool permissioning;
- model input/output logging where appropriate;
- clear provenance for every generated or refreshed element.

AI-powered security should help inspect project content, code snippets, data bindings, uploaded files, prompts, and agent actions for suspicious behavior. But AI checks should supplement deterministic controls, not replace them.

## What Percy Should Become

Percy should become the place where an organization manages its visual reporting system.

Not just decks.
Not just dashboards.
Not just templates.
Not just AI generation.

Percy should combine those into one operational platform:

- design surface;
- data binding layer;
- Python execution environment;
- AI assistant;
- template library;
- reporting memory;
- visual QA system;
- collaboration workspace;
- export engine.

The practical first wedge is still onboarding and high-fidelity reproduction. Trust starts with proving Percy can understand and rebuild existing artifacts. But the larger goal is a collaborative, Python-native, AI-safe enterprise reporting platform.

