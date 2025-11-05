#!/usr/bin/env python3
"""
Download PDFs from pdf_download_links.txt with tracking to avoid re-downloads.
Uses a JSON file to track downloaded files by URL hash and filename.
"""

import os
import sys
import json
import hashlib
import re
import time
from pathlib import Path
from urllib.parse import urlparse
import requests
from typing import Dict, List, Tuple


# Configuration
LINKS_FILE = "pdf_download_links.txt"
DOWNLOAD_DIR = "downloaded_pdfs"
TRACKING_FILE = "download_tracking.json"
TIMEOUT = 30  # seconds
MAX_RETRIES = 3
RETRY_DELAY = 2  # seconds


class DownloadTracker:
    """Track downloaded PDFs to avoid re-downloading."""

    def __init__(self, tracking_file: str):
        self.tracking_file = tracking_file
        self.data = self._load_tracking_data()

    def _load_tracking_data(self) -> Dict:
        """Load existing tracking data or create new."""
        if os.path.exists(self.tracking_file):
            try:
                with open(self.tracking_file, 'r') as f:
                    return json.load(f)
            except json.JSONDecodeError:
                print(f"Warning: Could not parse {self.tracking_file}, starting fresh.")
                return {"downloads": {}}
        return {"downloads": {}}

    def _save_tracking_data(self):
        """Save tracking data to disk."""
        with open(self.tracking_file, 'w') as f:
            json.dump(self.data, indent=2, fp=f)

    def get_url_hash(self, url: str) -> str:
        """Generate a hash for the URL."""
        return hashlib.sha256(url.encode()).hexdigest()[:16]

    def is_downloaded(self, url: str) -> bool:
        """Check if URL has been downloaded."""
        url_hash = self.get_url_hash(url)
        return url_hash in self.data["downloads"]

    def mark_downloaded(self, url: str, filename: str, title: str):
        """Mark URL as downloaded."""
        url_hash = self.get_url_hash(url)
        self.data["downloads"][url_hash] = {
            "url": url,
            "filename": filename,
            "title": title,
            "downloaded_at": time.strftime("%Y-%m-%d %H:%M:%S")
        }
        self._save_tracking_data()

    def get_stats(self) -> Dict:
        """Get download statistics."""
        return {
            "total_downloaded": len(self.data["downloads"]),
            "tracking_file": self.tracking_file
        }


def extract_pdf_urls(links_file: str) -> List[Tuple[str, str]]:
    """
    Extract PDF URLs and titles from the links file.
    Returns list of (title, url) tuples.
    """
    urls = []
    current_title = ""

    with open(links_file, 'r') as f:
        for line in f:
            line = line.strip()

            # Skip empty lines and headers
            if not line or line.startswith('===') or line.startswith('PDF DOWNLOAD') or line.startswith('SUMMARY'):
                continue

            # Check if line is a numbered title
            title_match = re.match(r'^\d+\.\s+(.+)$', line)
            if title_match:
                current_title = title_match.group(1)
                continue

            # Check for PDF URLs
            if line.startswith('http') and '.pdf' in line.lower():
                # Handle special cases with labels (FULL CASE, PART 1, etc.)
                url_match = re.match(r'(?:FULL CASE|PART \d+):\s+(.+)', line)
                if url_match:
                    url = url_match.group(1)
                    # Modify title for multi-part cases
                    part_label = re.match(r'(FULL CASE|PART \d+):', line).group(1)
                    title = f"{current_title} - {part_label}"
                else:
                    url = line
                    title = current_title

                urls.append((title, url))

    return urls


def sanitize_filename(title: str) -> str:
    """Create a safe filename from title."""
    # Remove or replace unsafe characters
    safe_title = re.sub(r'[<>:"/\\|?*]', '', title)
    safe_title = re.sub(r'\s+', '_', safe_title)
    # Limit length
    if len(safe_title) > 200:
        safe_title = safe_title[:200]
    return safe_title + ".pdf"


def download_file(url: str, output_path: str, retries: int = MAX_RETRIES) -> bool:
    """
    Download a file with retry logic.
    Returns True if successful, False otherwise.
    """
    for attempt in range(retries):
        try:
            print(f"  Downloading (attempt {attempt + 1}/{retries})...", end=' ')

            response = requests.get(url, timeout=TIMEOUT, stream=True)
            response.raise_for_status()

            # Write file in chunks
            with open(output_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)

            file_size = os.path.getsize(output_path)
            print(f"✓ ({file_size:,} bytes)")
            return True

        except requests.exceptions.RequestException as e:
            print(f"✗")
            if attempt < retries - 1:
                print(f"  Error: {e}")
                print(f"  Retrying in {RETRY_DELAY}s...")
                time.sleep(RETRY_DELAY)
            else:
                print(f"  Failed after {retries} attempts: {e}")
                # Clean up partial download
                if os.path.exists(output_path):
                    os.remove(output_path)
                return False

    return False


def main():
    """Main download function."""
    print("PDF Downloader for MIT Sloan Teaching Resources")
    print("=" * 60)

    # Initialize
    if not os.path.exists(LINKS_FILE):
        print(f"Error: {LINKS_FILE} not found!")
        sys.exit(1)

    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    tracker = DownloadTracker(TRACKING_FILE)

    # Extract URLs
    print(f"\nExtracting URLs from {LINKS_FILE}...")
    pdf_urls = extract_pdf_urls(LINKS_FILE)
    print(f"Found {len(pdf_urls)} PDF(s) to process")

    # Get stats
    stats = tracker.get_stats()
    print(f"Already downloaded: {stats['total_downloaded']}")
    print(f"Tracking file: {stats['tracking_file']}")

    # Download PDFs
    print(f"\nDownload directory: {DOWNLOAD_DIR}/")
    print("=" * 60)

    downloaded = 0
    skipped = 0
    failed = 0

    for idx, (title, url) in enumerate(pdf_urls, 1):
        print(f"\n[{idx}/{len(pdf_urls)}] {title}")

        # Check if already downloaded
        if tracker.is_downloaded(url):
            print("  ⏭  Already downloaded (skipping)")
            skipped += 1
            continue

        # Generate filename
        filename = sanitize_filename(title)
        output_path = os.path.join(DOWNLOAD_DIR, filename)

        # Check if file exists (manual download or previous failed tracking)
        if os.path.exists(output_path):
            print(f"  ⚠  File exists: {filename}")
            print("  Marking as downloaded in tracking system")
            tracker.mark_downloaded(url, filename, title)
            skipped += 1
            continue

        # Download
        print(f"  → {filename}")
        if download_file(url, output_path):
            tracker.mark_downloaded(url, filename, title)
            downloaded += 1
        else:
            failed += 1

        # Small delay to be respectful
        if idx < len(pdf_urls):
            time.sleep(0.5)

    # Final summary
    print("\n" + "=" * 60)
    print("DOWNLOAD SUMMARY")
    print("=" * 60)
    print(f"Total PDFs processed:  {len(pdf_urls)}")
    print(f"Newly downloaded:      {downloaded}")
    print(f"Skipped (existing):    {skipped}")
    print(f"Failed:                {failed}")
    print(f"\nAll files saved to:    {DOWNLOAD_DIR}/")
    print(f"Tracking file:         {TRACKING_FILE}")

    if failed > 0:
        print(f"\n⚠  {failed} file(s) failed to download. Re-run this script to retry.")
        sys.exit(1)
    else:
        print("\n✓ All downloads completed successfully!")
        sys.exit(0)


if __name__ == "__main__":
    main()
