#!/usr/bin/env python3
"""
Script to scrape case study subgroup links from MIT Sloan Teaching Resources Library
"""

import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin
import json

def get_case_study_links(base_url="https://mitsloan.mit.edu/teaching-resources-library/case-studies"):
    """
    Fetch all case study subgroup links from the main case studies page.

    Args:
        base_url: The main case studies page URL

    Returns:
        List of dictionaries containing title and URL for each subgroup
    """
    try:
        # Fetch the page
        response = requests.get(base_url, timeout=10)
        response.raise_for_status()

        # Parse HTML
        soup = BeautifulSoup(response.content, 'html.parser')

        # Find all case study category links
        case_study_links = []

        # Look for links that contain "case-studies" in the href
        for link in soup.find_all('a', href=True):
            href = link['href']

            # Filter for case study subgroup links
            if 'teaching-resources-library' in href and 'case' in href.lower():
                full_url = urljoin(base_url, href)

                # Avoid duplicates and the main page itself
                if full_url != base_url and full_url not in [item['url'] for item in case_study_links]:
                    title = link.get_text(strip=True)

                    # Only add if it has meaningful text
                    if title:
                        case_study_links.append({
                            'title': title,
                            'url': full_url
                        })

        return case_study_links

    except requests.RequestException as e:
        print(f"Error fetching the page: {e}")
        return []

def main():
    """Main function to run the scraper"""
    print("Fetching case study subgroup links from MIT Sloan...")
    print()

    links = get_case_study_links()

    if links:
        print(f"Found {len(links)} case study subgroups:\n")

        for idx, item in enumerate(links, 1):
            print(f"{idx}. {item['title']}")
            print(f"   {item['url']}")
            print()

        # Save to JSON file
        output_file = "case_study_subgroups.json"
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(links, f, indent=2, ensure_ascii=False)

        print(f"\nResults saved to {output_file}")
    else:
        print("No case study links found.")

if __name__ == "__main__":
    main()
