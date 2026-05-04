"""
Percy PPTX Scraper  —  v3
==========================
What changed from v2 and WHY it didn't work:
  - v2 searched for .pptx URLs *inside* search-result HTML.  They're never there.
    Google/DDG result pages contain links to HTML pages, not to files.
  - v2's LLM HTML extractor overflowed the 4096-token context window.
  - Almost all public company IR presentations are served as PDF (not PPTX).

Correct strategy (this version):
  1. Search DuckDuckGo (HTML endpoint, no Selenium required) → get result-page URLs
  2. Visit every result page with requests + BeautifulSoup → find .pdf / .pptx hrefs
  3. For every .pdf found, also try a .pptx URL variant (same path, swap extension)
  4. For JS-heavy IR pages that returned nothing, retry with Selenium
  5. Accept BOTH .pdf and .pptx — they're both valuable presentation artifacts
  6. LLM (Gemma) used only for query generation and final URL ranking — NOT for HTML parsing

Usage:
    python scraper.py                      # first 10 companies
    python scraper.py --limit 50
    python scraper.py --ids 1 10 12 26 27
    python scraper.py --ids 1 --no-headless   # visible browser, good for debugging
"""

from __future__ import annotations

import argparse
import base64
import json
import logging
import os
import re
import time
from datetime import datetime
from io import BytesIO
from pathlib import Path
from urllib.parse import parse_qs, quote_plus, unquote, urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from openai import OpenAI
from PIL import Image

# Selenium — needed for JS-heavy IR pages
from selenium import webdriver
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from webdriver_manager.chrome import ChromeDriverManager

# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).parent
DUMP_DIR = BASE_DIR / "dump_pptx"
METADATA_PATH = BASE_DIR / "metadata.json"
DUMP_DIR.mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(), logging.FileHandler(BASE_DIR / "scraper.log")],
)
log = logging.getLogger(__name__)

# File types we'll download
ACCEPTED_EXTENSIONS = {".pptx", ".ppt", ".pdf"}

# CDN / file-host URL patterns that strongly suggest a downloadable presentation
CDN_PATTERNS = [
    "q4cdn.com",
    "/static-files/",
    "/doc_presentations/",
    "/doc_downloads/",
    "/files/doc_",
    "hubfs/",
    "/investor-presentations/",
    "/files/ir/",
    "/files/presentations/",
]

PRESENTATION_KEYWORDS = [
    "presentation", "investor day", "earnings", "annual report",
    "conference", "slides", "deck", "shareholder",
]


# ===========================================================================
# Gemma-3-27b  (query gen + URL ranking only — no HTML parsing)
# ===========================================================================

class LocalLLM:
    MODEL = "google/gemma-4-e4b"
    BASE_URL = "http://localhost:1234/v1"
    MAX_CONTEXT_CHARS = 2500  # ~500 tokens, well within 4096 limit

    def __init__(self):
        self.client = OpenAI(base_url=self.BASE_URL, api_key="lm-studio")

    def _text(self, prompt: str, max_tokens: int = 500) -> str:
        try:
            resp = self.client.chat.completions.create(
                model=self.MODEL,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=max_tokens,
                temperature=0.1,
            )
            return resp.choices[0].message.content.strip()
        except Exception as exc:
            log.warning("LLM call failed: %s", exc)
            return ""

    def _vision(self, prompt: str, img_b64: str, max_tokens: int = 300) -> str:
        try:
            resp = self.client.chat.completions.create(
                model=self.MODEL,
                messages=[{"role": "user", "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img_b64}"}},
                ]}],
                max_tokens=max_tokens,
                temperature=0.1,
            )
            return resp.choices[0].message.content.strip()
        except Exception as exc:
            log.warning("LLM vision call failed: %s", exc)
            return ""

    def generate_search_queries(self, name: str, industry: str, domain: str | None) -> list[str]:
        prompt = (
            f"Generate 4 plain web search queries (no filetype: operators, no site: operators) "
            f"to find publicly downloadable investor presentations from {name} ({industry}"
            f"{f', {domain}' if domain else ''}).\n"
            "Focus on: investor day, earnings presentation, conference slides, annual meeting.\n"
            "Return only the queries, one per line, no numbering, no quotes around them."
        )
        result = self._text(prompt, max_tokens=250)
        queries = [q.strip().strip('"\'') for q in result.splitlines()
                   if q.strip() and len(q.strip()) > 8
                   and "filetype:" not in q and "site:" not in q]
        return queries[:4]

    def rank_urls(self, urls: list[str], name: str) -> list[str]:
        """Heuristic pre-sort, then LLM re-ranks the top 15 to stay within context."""
        if len(urls) <= 1:
            return urls

        # 1. Fast heuristic pre-sort (no LLM needed)
        def _score(url: str) -> int:
            u = url.lower()
            s = 0
            if u.endswith(".pptx"):         s += 8
            elif u.endswith(".ppt"):        s += 7
            elif u.endswith(".pdf"):        s += 6
            for yr in ("2025", "2024", "2023", "2022"):
                if yr in u: s += 4; break
            for kw in ("investor", "earnings", "presentation", "annual", "conference", "deck"):
                if kw in u: s += 2
            for bad in ("template", "sample", "tutorial", "slideshare", "scribd", "wikipedia"):
                if bad in u: s -= 8
            # Reward company-domain URLs
            slug = re.sub(r"[^a-z]", "", name.lower())[:10]
            if slug in u: s += 5
            for cdn in ("q4cdn", "static-files", "investor", "ir."):
                if cdn in u: s += 3
            return -s  # negative → sort ascending = highest score first

        presorted = sorted(urls, key=_score)

        # 2. LLM re-ranks only the top 15 (fits comfortably in 4096 tokens)
        top15 = presorted[:15]
        listing = "\n".join(top15)
        prompt = (
            f"Re-rank these URLs best-first for an official {name} investor presentation "
            f"(.pptx preferred, then .pdf; prefer 2022-2025, company domain, "
            f"'investor'/'earnings'/'presentation' keywords; deprioritise slideshare/scribd/templates).\n\n"
            f"Copy ONLY URLs from this exact list, one per line:\n{listing}"
        )
        result = self._text(prompt, max_tokens=600)
        original_set = set(urls)
        llm_ranked = [u.strip() for u in result.splitlines()
                      if u.strip().startswith("http") and u.strip() in original_set]
        # Append anything not returned by the LLM (rest of presorted list)
        seen = set(llm_ranked)
        llm_ranked += [u for u in presorted if u not in seen]
        return llm_ranked

    def is_captcha(self, img_b64: str) -> bool:
        result = self._vision(
            "Is this a CAPTCHA or bot-detection page? YES or NO only.",
            img_b64, max_tokens=5,
        )
        return "YES" in result.upper()


# ===========================================================================
# Scraper
# ===========================================================================

class PPTXScraper:
    HEADERS = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        )
    }

    def __init__(self, headless: bool = True):
        self.llm = LocalLLM()
        self.session = requests.Session()
        self.session.headers.update(self.HEADERS)
        self.metadata = self._load_metadata()
        self.driver = self._init_driver(headless)

    # ------------------------------------------------------------------
    # Setup / teardown
    # ------------------------------------------------------------------

    def _init_driver(self, headless: bool) -> webdriver.Chrome:
        opts = ChromeOptions()
        if headless:
            opts.add_argument("--headless=new")
        opts.add_argument("--no-sandbox")
        opts.add_argument("--disable-dev-shm-usage")
        opts.add_argument("--disable-blink-features=AutomationControlled")
        opts.add_argument("--window-size=1440,900")
        opts.add_experimental_option("excludeSwitches", ["enable-automation"])
        opts.add_experimental_option("useAutomationExtension", False)
        opts.add_argument(f'user-agent={self.HEADERS["User-Agent"]}')
        driver = webdriver.Chrome(
            service=Service(ChromeDriverManager().install()), options=opts
        )
        driver.execute_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
        )
        return driver

    def close(self) -> None:
        try:
            self.driver.quit()
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Metadata
    # ------------------------------------------------------------------

    def _load_metadata(self) -> dict:
        with open(METADATA_PATH, encoding="utf-8") as f:
            return json.load(f)

    def _save_metadata(self) -> None:
        self.metadata["last_updated"] = datetime.utcnow().strftime("%Y-%m-%d")
        with open(METADATA_PATH, "w", encoding="utf-8") as f:
            json.dump(self.metadata, f, indent=2)

    def _already_scraped(self, url: str) -> bool:
        return any(r.get("source_url") == url for r in self.metadata.get("scraped_files", []))

    # ------------------------------------------------------------------
    # Link extraction from HTML
    # ------------------------------------------------------------------

    def _extract_file_links(self, html: str, base_url: str) -> list[str]:
        """
        Parse HTML and return URLs that are likely presentation file downloads.
        Accepts: .pdf, .pptx, .ppt, and extensionless CDN links that match known patterns.
        For every .pdf found, also appends a .pptx variant to try.
        """
        soup = BeautifulSoup(html, "lxml")
        found: list[str] = []

        for tag in soup.find_all(["a", "button"], href=True):
            raw = tag.get("href", "")
            if not raw:
                continue
            href = urljoin(base_url, raw)
            href_clean = href.lower().split("?")[0]
            link_text = tag.get_text(" ", strip=True).lower()

            ext = Path(urlparse(href_clean).path).suffix.lower()

            if ext in ACCEPTED_EXTENSIONS:
                found.append(href)

            elif not ext and any(p in href.lower() for p in CDN_PATTERNS):
                if any(kw in link_text for kw in PRESENTATION_KEYWORDS):
                    found.append(href)

        # Also scan onclick / data-* attrs for hidden URLs
        for tag in soup.find_all(attrs={"onclick": True}):
            matches = re.findall(r'https?://[^\s"\']+\.(?:pdf|pptx|ppt)', tag["onclick"], re.I)
            found.extend(matches)

        return list(dict.fromkeys(found))  # dedupe, preserve order

    # ------------------------------------------------------------------
    # Search: DuckDuckGo HTML endpoint (no Selenium, no rate-limit)
    # ------------------------------------------------------------------

    def _ddg_search(self, query: str) -> list[str]:
        """
        POST to DuckDuckGo's plain-HTML endpoint and return result-page URLs.
        These are HTML page URLs, NOT file URLs — we follow them next.
        Uses a fresh session per call to avoid stale cookie/referer state.
        """
        ddg_session = requests.Session()
        ddg_session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
        })
        try:
            resp = ddg_session.post(
                "https://html.duckduckgo.com/html/",
                data={"q": query, "kl": "us-en"},
                timeout=15,
            )
            resp.raise_for_status()
        except requests.RequestException as exc:
            log.warning("DDG search failed for %r: %s", query, exc)
            return []

        soup = BeautifulSoup(resp.text, "lxml")
        urls: list[str] = []
        for a in soup.select("a.result__a"):
            href = a.get("href", "")
            # DDG sometimes wraps real URLs: /l/?uddg=<encoded-real-url>
            if "uddg=" in href:
                qs = parse_qs(urlparse(href).query)
                real = qs.get("uddg", [""])[0]
                if real:
                    href = unquote(real)
            if href.startswith("http"):
                urls.append(href)
        log.debug("DDG returned %d results for %r", len(urls), query)
        return urls

    # ------------------------------------------------------------------
    # Follow a result page to find file download links
    # ------------------------------------------------------------------

    def _follow_page_for_files(self, url: str, use_selenium_fallback: bool = True) -> list[str]:
        """
        Fetch a page with requests+BS4. If JS-heavy (returns very little content),
        retry with Selenium. Returns list of file download URLs.
        """
        html = ""
        try:
            resp = self.session.get(url, timeout=20, allow_redirects=True)
            resp.raise_for_status()
            html = resp.text
        except requests.RequestException as exc:
            log.debug("requests failed for %s: %s", url, exc)

        links = self._extract_file_links(html, url) if html else []

        # If we got nothing and it smells like a JS SPA, try Selenium
        if not links and use_selenium_fallback and any(
            kw in url.lower() for kw in ["investor", "ir.", "/ir/", "events", "presentations"]
        ):
            links = self._selenium_follow_page(url)

        return links

    def _selenium_follow_page(self, url: str) -> list[str]:
        """Load a page in Selenium (handles JS SPAs), scroll, extract file links."""
        try:
            self.driver.get(url)
            time.sleep(4)

            # Text-based CAPTCHA check — require a strong signal, not just 2 weak ones
            src_lower = self.driver.page_source.lower()
            strong_signals = ["captcha", "i am not a robot", "verify you are human", "cloudflare ray id"]
            soft_signals   = ["access denied", "403 forbidden", "rate limited", "blocked"]
            is_blocked = (
                any(s in src_lower for s in strong_signals) or
                sum(1 for s in soft_signals if s in src_lower) >= 2
            )
            if is_blocked:
                log.warning("CAPTCHA/block detected on %s — skipping", url)
                return []

            # Scroll to load lazy content
            for _ in range(3):
                self.driver.execute_script("window.scrollBy(0, 600)")
                time.sleep(1)

            return self._extract_file_links(self.driver.page_source, url)
        except Exception as exc:
            log.debug("Selenium follow failed for %s: %s", url, exc)
            return []

    def _screenshot_b64(self, max_width: int = 1280) -> str:
        png = self.driver.get_screenshot_as_png()
        img = Image.open(BytesIO(png))
        if img.width > max_width:
            img = img.resize((max_width, int(img.height * max_width / img.width)), Image.LANCZOS)
        buf = BytesIO()
        img.save(buf, format="PNG", optimize=True)
        return base64.b64encode(buf.getvalue()).decode()

    # ------------------------------------------------------------------
    # Bing API (optional, set BING_API_KEY env var)
    # ------------------------------------------------------------------

    def _bing_search(self, query: str) -> list[str]:
        key = os.environ.get("BING_API_KEY")
        if not key:
            return []
        try:
            resp = requests.get(
                "https://api.bing.microsoft.com/v7.0/search",
                params={"q": query, "count": 15},
                headers={"Ocp-Apim-Subscription-Key": key},
                timeout=10,
            )
            resp.raise_for_status()
            return [p["url"] for p in resp.json().get("webPages", {}).get("value", [])]
        except Exception as exc:
            log.debug("Bing API: %s", exc)
            return []

    # ------------------------------------------------------------------
    # Aggregate: search → collect result pages → follow → find files
    # ------------------------------------------------------------------

    def find_presentation_urls(self, company: dict) -> list[str]:
        name = company["name"]
        domain = company.get("domain")
        ir_url = company.get("ir_url")
        industry = company.get("industry", "")

        # 1. LLM generates targeted search queries
        log.info("  Generating queries with Gemma...")
        llm_queries = self.llm.generate_search_queries(name, industry, domain)
        base_queries = [
            f"{name} investor day presentation download",
            f"{name} earnings presentation slides 2024",
        ]
        queries = llm_queries + [q for q in base_queries if q not in llm_queries]
        log.info("  Queries: %s", queries)

        # 2. Search DDG + Bing → collect result-page URLs
        result_pages: list[str] = []
        for q in queries[:5]:
            result_pages.extend(self._ddg_search(q))
            result_pages.extend(self._bing_search(q))
            time.sleep(1.5)

        # 3. Add known IR sub-pages directly (reliable, no search needed)
        if ir_url:
            ir = ir_url.rstrip("/")
            result_pages.extend([
                ir,
                ir + "/events-and-presentations",
                ir + "/events-and-presentations/default.aspx",
                ir + "/presentations",
                ir + "/presentations/default.aspx",
                ir + "/events",
                ir + "/financial-information/presentations",
                ir + "/financial-information/events-and-presentations",
                ir + "/static-files",   # some Q4-hosted sites
            ])

        # Dedupe result pages
        seen: set[str] = set()
        result_pages = [u for u in result_pages if not (u in seen or seen.add(u))]  # type: ignore

        # De-prioritise obvious non-IR pages before following
        def _page_priority(u: str) -> int:
            u = u.lower()
            s = 0
            for kw in ("investor", "ir.", "/ir/", "events", "presentations", "earnings", "q4cdn"):
                if kw in u: s -= 1  # lower = better
            for bad in ("youtube", "twitter", "linkedin", "reddit", "wikipedia",
                        "seekingalpha", "fool.com", "bloomberg", "cnbc"):
                if bad in u: s += 10
            return s
        result_pages.sort(key=_page_priority)

        log.info("  Following %d result pages to find file links...", min(len(result_pages), 20))

        # 4. Visit each result page and extract file download links
        all_file_urls: list[str] = []
        for page_url in result_pages[:20]:
            files = self._follow_page_for_files(page_url)
            if files:
                log.info("    Found %d file link(s) on %s", len(files), page_url)
            all_file_urls.extend(files)
            time.sleep(0.8)

        # 5. Dedupe file URLs
        seen2: set[str] = set()
        deduped = [u for u in all_file_urls if not (u in seen2 or seen2.add(u))]  # type: ignore

        if not deduped:
            log.info("  No file URLs found for %s", name)
            return []

        # 6. LLM ranking
        log.info("  Ranking %d candidate URLs with Gemma...", len(deduped))
        ranked = self.llm.rank_urls(deduped, name)
        log.info("  Top 5: %s", ranked[:5])
        return ranked

    # ------------------------------------------------------------------
    # Download
    # ------------------------------------------------------------------

    def download_file(self, url: str, company_name: str) -> dict | None:
        """Download a presentation file (PDF or PPTX). Returns a file record or None."""
        if self._already_scraped(url):
            return None

        try:
            resp = self.session.get(url, timeout=45, stream=True)
            resp.raise_for_status()
        except requests.RequestException as exc:
            log.info("  Download failed (%s): %s", type(exc).__name__, url)
            return None

        content_type = resp.headers.get("Content-Type", "").lower()

        # Determine file extension from Content-Type or URL
        if "presentationml" in content_type or "pptx" in content_type or url.lower().endswith(".pptx"):
            ext = ".pptx"
        elif "pdf" in content_type or url.lower().endswith(".pdf"):
            ext = ".pdf"
        elif "powerpoint" in content_type or url.lower().endswith(".ppt"):
            ext = ".ppt"
        elif "octet-stream" in content_type:
            # Guess from URL
            url_path = urlparse(url).path.lower()
            if ".pptx" in url_path:
                ext = ".pptx"
            elif ".pdf" in url_path:
                ext = ".pdf"
            else:
                ext = ".bin"
        else:
            log.info("  Skipping unknown content type %s at %s", content_type, url)
            return None

        # Construct filename
        original_name = os.path.basename(urlparse(url).path) or "presentation"
        if not original_name.lower().endswith(ext):
            original_name += ext
        safe_co = re.sub(r"[^\w-]", "_", company_name.lower())
        ts = datetime.utcnow().strftime("%Y%m%d")
        filename = f"{safe_co}_{ts}_{original_name}"
        dest = DUMP_DIR / filename

        with open(dest, "wb") as fh:
            for chunk in resp.iter_content(8192):
                fh.write(chunk)

        size_kb = dest.stat().st_size // 1024
        if size_kb < 5:
            dest.unlink()
            log.info("  Discarded tiny file (%d KB) from %s", size_kb, url)
            return None

        log.info("  SAVED %s (%d KB) [%s]", filename, size_kb, ext)
        return {
            "filename": filename,
            "file_type": ext.lstrip("."),
            "company": company_name,
            "source_url": url,
            "scraped_date": datetime.utcnow().isoformat(),
            "file_size_kb": size_kb,
            "status": "downloaded",
            "notes": "",
            "formatting_analysis": {
                "has_custom_fonts": None,
                "color_palette": [],
                "slide_count": None,
                "has_animations": None,
                "has_video": None,
                "has_complex_charts": None,
                "has_embedded_excel": None,
                "has_smartart": None,
                "has_3d_elements": None,
                "master_slide_count": None,
                "formatting_issues": [],
                "percy_compatibility_score": None,
            },
        }

    # ------------------------------------------------------------------
    # Inline quality check (calls analyzer.py logic)
    # ------------------------------------------------------------------

    def _quality_check(self, record: dict) -> dict:
        """
        Run the branding verifier on a freshly downloaded file.
        Imports from analyzer.py so the logic stays in one place.
        Mutates and returns the record with quality_check filled in.
        On failure, moves the file to dump_pptx/rejected/.
        """
        try:
            from analyzer import LocalLLM as AnalyzerLLM, analyze_file
            llm = AnalyzerLLM()
            analyze_file(record, llm, dry_run=False)
        except Exception as exc:
            log.warning("Quality check failed for %s: %s", record.get("filename"), exc)
            record.setdefault("quality_check", {"passed": True, "verdict": "SKIPPED"})
            record["status"] = "downloaded"  # keep if check errored
        return record

    # ------------------------------------------------------------------
    # Per-company orchestration
    # ------------------------------------------------------------------

    def scrape_company(self, company: dict, max_files: int = 5) -> int:
        name = company["name"]
        log.info("=" * 60)
        log.info("Scraping: %s  [id=%d, %s]", name, company["id"], company["industry"])
        log.info("=" * 60)

        urls = self.find_presentation_urls(company)
        if not urls:
            return 0

        count = 0
        for url in urls[:max_files]:
            record = self.download_file(url, name)
            if record:
                # Immediate quality check — reject bad files before storing
                record = self._quality_check(record)
                self.metadata["scraped_files"].append(record)
                if record.get("status") == "verified":
                    count += 1
                else:
                    log.info("  Discarded (quality check failed): %s", record["filename"])

        self._save_metadata()
        log.info("Done: %s — %d verified file(s)", name, count)
        return count

    def run(
        self,
        limit: int | None = None,
        company_ids: list[int] | None = None,
        max_files: int = 5,
    ) -> None:
        companies = self.metadata["target_companies"]
        if company_ids:
            companies = [c for c in companies if c["id"] in company_ids]
        elif limit:
            companies = companies[:limit]

        total = 0
        for company in companies:
            try:
                total += self.scrape_company(company, max_files=max_files)
            except Exception:
                log.exception("Error scraping %s", company["name"])
            time.sleep(3)

        log.info("Run complete — %d new files downloaded.", total)


# ===========================================================================
# CLI
# ===========================================================================

def main() -> None:
    parser = argparse.ArgumentParser(description="Percy Presentation Scraper")
    parser.add_argument("--no-headless", action="store_true", help="Show Chrome window")
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--ids", nargs="+", type=int, metavar="ID")
    parser.add_argument("--max-files", type=int, default=5)
    args = parser.parse_args()

    scraper = PPTXScraper(headless=not args.no_headless)
    try:
        scraper.run(limit=args.limit, company_ids=args.ids, max_files=args.max_files)
    finally:
        scraper.close()


if __name__ == "__main__":
    main()
