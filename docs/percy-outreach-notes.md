# Percy Outreach Notes

Last updated: 2026-05-02

## Role

The outreach pipeline is the dataset expansion loop for Percy. It searches for public company presentation materials, downloads presentation files, filters out junk with the local LM Studio vision check, and stores verified artifacts in `outreach/dump_pptx`.

## Current Registry

- `outreach/metadata.json` now contains 622 target companies.
- The registry is intentionally broad across enterprise SaaS, finance, healthcare, industrials, consumer, travel, telecom, international software, and fintech.
- The goal is to keep expanding the universe rather than repeatedly scraping the same narrow set.

## Current Long-Run Crawl

Active command:

```powershell
python scraper.py --limit 999 --max-files 3
```

Working directory:

```text
outreach/
```

Current logs:

- `outreach/scraper_622.out.log`
- `outreach/scraper_622.err.log`

## LM Studio Assumptions

The outreach scraper uses the local LM Studio server at:

```text
http://127.0.0.1:1234/v1
```

Default model:

```text
google/gemma-4-e4b
```

The scraper uses LM Studio for:

- search query generation
- URL ranking
- image-based quality checks on downloaded files

## Expansion Workflow

- To add more companies, extend `outreach/expand_companies.py`.
- Run `python outreach/expand_companies.py` to append new entries to `outreach/metadata.json`.
- Restart the crawler after expanding the registry so the new targets are picked up.

## Notes For Agents

- Keep the scraper as the canonical outreach worker.
- Avoid starting multiple crawler processes at once unless you intentionally want extra concurrency.
- If LM Studio starts ejecting the model, reduce concurrent vision requests first.
- If the crawl stalls, check the error log before restarting anything.
