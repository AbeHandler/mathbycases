#!/usr/bin/env python3
"""
Scraper to fetch all MIT Sloan case studies from a given page.
"""

import requests
from bs4 import BeautifulSoup
import json
import time
from typing import List, Dict

def parse_case_element(case_elem) -> Dict:
    """Parse a single case study element and extract relevant information."""
    case_data = {}

    # The case_elem is an <a> tag containing all the case info
    case_data['url'] = case_elem.get('href', '')
    if case_data['url'] and not case_data['url'].startswith('http'):
        case_data['url'] = 'https://mitsloan.mit.edu' + case_data['url']

    # Extract title (in h3)
    title_elem = case_elem.find('h3')
    if title_elem:
        case_data['title'] = title_elem.get_text(strip=True)

    # Extract all p tags
    p_tags = case_elem.find_all('p')

    # First p usually contains authors (starts with "By")
    authors = []
    description = ''
    date = ''

    for p in p_tags:
        text = p.get_text(strip=True)
        if text.startswith('By '):
            # Authors
            authors_text = text[3:]  # Remove "By "
            authors = [a.strip() for a in authors_text.split(',')]
        elif ',' in text and any(month in text for month in ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']):
            # Date
            date = text
        else:
            # Description (longest p tag that's not authors or date)
            if len(text) > len(description):
                description = text

    case_data['authors'] = authors
    case_data['description'] = description
    case_data['date'] = date

    # Extract categories (in div after img)
    div_elem = case_elem.find('div')
    if div_elem:
        categories_text = div_elem.get_text(strip=True)
        # Split by common category names, but keep as full text for now
        case_data['categories'] = categories_text

    return case_data

def fetch_all_cases(page_url: str) -> List[Dict]:
    """
    Fetch all case studies from a MIT Sloan page that uses Load More functionality.

    Args:
        page_url: The initial page URL to start scraping from

    Returns:
        List of dictionaries containing case study information
    """
    print(f"Fetching initial page: {page_url}")

    all_cases = []

    # Fetch the initial page
    response = requests.get(page_url)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, 'html.parser')

    # Parse initial cases - they are <a> tags with href starting with /teaching-resources-library/
    # Filter to only those that contain an h3 tag (actual case links, not nav links)
    all_links = soup.find_all('a', href=lambda href: href and href.startswith('/teaching-resources-library/') and href != '/teaching-resources-library/mit-sloan-case-studies-0')
    case_elements = [link for link in all_links if link.find('h3')]
    print(f"Found {len(case_elements)} cases on initial page")

    for i, case_elem in enumerate(case_elements):
        case_data = parse_case_element(case_elem)
        if case_data.get('title'):
            all_cases.append(case_data)
        elif i == 0:
            # Debug first element if no title found
            print(f"DEBUG: First element has no title. HTML snippet: {str(case_elem)[:500]}")

    # Find the Load More button to get API parameters
    load_more = soup.find('a', string='Load More')
    if not load_more:
        print("No 'Load More' button found. Returning initial results only.")
        return all_cases

    # Extract API parameters from the Load More URL
    load_more_url = load_more.get('href', '')
    if not load_more_url:
        print("No Load More URL found. Returning initial results only.")
        return all_cases

    # Parse the API URL
    # Format: /api/loadmore/dynamic_list_master?pid=66387&offset=10&base_nid=19867
    base_api_url = 'https://mitsloan.mit.edu/api/loadmore/dynamic_list_master'

    # Extract parameters
    import urllib.parse
    parsed = urllib.parse.urlparse(load_more_url)
    params = urllib.parse.parse_qs(parsed.query)

    pid = params.get('pid', [None])[0]
    base_nid = params.get('base_nid', [None])[0]
    initial_offset = int(params.get('offset', ['10'])[0])

    if not pid or not base_nid:
        print("Could not extract API parameters. Returning initial results only.")
        return all_cases

    print(f"\nAPI Parameters: pid={pid}, base_nid={base_nid}")
    print("Fetching additional cases via Load More API...")

    # Fetch remaining cases via API
    offset = initial_offset
    batch_num = 2

    while True:
        api_params = {
            'pid': pid,
            'base_nid': base_nid,
            'offset': offset
        }

        print(f"\nFetching batch {batch_num} (offset={offset})...")

        try:
            response = requests.get(base_api_url, params=api_params)
            response.raise_for_status()

            # Check if response is empty or just whitespace
            if not response.text or not response.text.strip():
                print("Empty response received. All cases fetched.")
                break

            # Parse the HTML response
            soup = BeautifulSoup(response.text, 'html.parser')
            case_elements = soup.find_all('a', href=lambda href: href and href.startswith('/teaching-resources-library/'))

            if not case_elements:
                print("No more cases found. All cases fetched.")
                break

            print(f"Found {len(case_elements)} cases in this batch")

            for case_elem in case_elements:
                case_data = parse_case_element(case_elem)
                if case_data.get('title'):
                    all_cases.append(case_data)

            offset += 10
            batch_num += 1

            # Be polite to the server
            time.sleep(0.5)

        except requests.exceptions.RequestException as e:
            print(f"Error fetching batch: {e}")
            break

    print(f"\n✓ Total cases fetched: {len(all_cases)}")
    return all_cases

def main():
    # URL for the Operations Management case studies page
    url = "https://mitsloan.mit.edu/teaching-resources-library/mit-sloan-case-studies-0"

    print("=" * 60)
    print("MIT Sloan Case Studies Scraper")
    print("=" * 60)

    cases = fetch_all_cases(url)

    # Save to JSON
    output_file = 'mit_sloan_cases.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(cases, f, indent=2, ensure_ascii=False)

    print(f"\n✓ Results saved to {output_file}")

    # Print summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Total cases: {len(cases)}")
    if cases:
        print(f"\nFirst case:")
        print(f"  Title: {cases[0].get('title', 'N/A')}")
        print(f"  Authors: {', '.join(cases[0].get('authors', []))}")
        print(f"  URL: {cases[0].get('url', 'N/A')}")

        print(f"\nLast case:")
        print(f"  Title: {cases[-1].get('title', 'N/A')}")
        print(f"  Authors: {', '.join(cases[-1].get('authors', []))}")
        print(f"  URL: {cases[-1].get('url', 'N/A')}")

if __name__ == '__main__':
    main()
