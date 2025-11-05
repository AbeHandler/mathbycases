#!/usr/bin/env node
/**
 * Scraper to fetch all MIT Sloan case studies by clicking "Load More" button
 * Uses Puppeteer to handle dynamic content loading
 */

const puppeteer = require('puppeteer');
const fs = require('fs').promises;

async function fetchAllCases(url) {
  console.log('='.repeat(60));
  console.log('MIT Sloan Case Studies Scraper (Puppeteer)');
  console.log('='.repeat(60));
  console.log(`\nLaunching browser and navigating to: ${url}`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // Set a reasonable viewport
  await page.setViewport({ width: 1280, height: 800 });

  // Navigate to the page
  await page.goto(url, { waitUntil: 'networkidle2' });

  console.log('✓ Page loaded');

  // Debug: Let's see what's actually on the page
  const pageInfo = await page.evaluate(() => {
    const h3s = Array.from(document.querySelectorAll('h3'));
    const h3Info = h3s.slice(0, 5).map(h3 => ({
      text: h3.textContent.trim(),
      parent: h3.parentElement.tagName,
      hasLink: !!h3.querySelector('a'),
      linkInParent: !!h3.parentElement.querySelector('a')
    }));

    return {
      title: document.title,
      allLinks: document.querySelectorAll('a[href*="teaching-resources-library"]').length,
      linksWithH3: Array.from(document.querySelectorAll('a')).filter(a => a.querySelector('h3')).length,
      h3Count: document.querySelectorAll('h3').length,
      loadMoreButtons: document.querySelectorAll('a[href*="loadmore"]').length,
      h3Samples: h3Info
    };
  });

  console.log('Page debug info:', JSON.stringify(pageInfo, null, 2));

  let clickCount = 0;
  let casesBeforeClick = 0;

  // Keep clicking "Load More" until it's no longer available
  while (true) {
    // Count current cases - h3 elements that contain links to case studies
    const caseCount = await page.evaluate(() => {
      const h3s = document.querySelectorAll('h3');
      const caseH3s = Array.from(h3s).filter(h3 => {
        const link = h3.querySelector('a[href^="/teaching-resources-library/"]');
        return link && !link.href.includes('/mit-sloan-case-studies');
      });
      return caseH3s.length;
    });

    console.log(`\nCurrent cases on page: ${caseCount}`);

    // Look for "Load More" button - wait a bit for it to appear after previous load
    await new Promise(resolve => setTimeout(resolve, 1000));

    const loadMoreButton = await page.$('a[href*="/api/loadmore/dynamic_list_master"]');

    if (!loadMoreButton) {
      console.log('✓ No more "Load More" button found');
      break;
    }

    // Check if button is visible
    const isVisible = await page.evaluate(el => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }, loadMoreButton);

    if (!isVisible) {
      console.log('✓ "Load More" button is hidden - all cases loaded');
      break;
    }

    casesBeforeClick = caseCount;
    clickCount++;

    console.log(`Clicking "Load More" button (click #${clickCount})...`);

    // Scroll to the button first
    await page.evaluate(el => el.scrollIntoView(), loadMoreButton);
    await new Promise(resolve => setTimeout(resolve, 500));

    // Click the button
    await loadMoreButton.click();

    // Wait for new content to load
    try {
      await page.waitForFunction(
        (prevCount) => {
          const h3s = document.querySelectorAll('h3');
          const caseH3s = Array.from(h3s).filter(h3 => {
            const link = h3.querySelector('a[href^="/teaching-resources-library/"]');
            return link && !link.href.includes('/mit-sloan-case-studies');
          });
          return caseH3s.length > prevCount;
        },
        { timeout: 5000 },
        casesBeforeClick
      );
      console.log('✓ New content loaded');
    } catch (error) {
      console.log('⚠ Timeout waiting for new content or no new content loaded');
      break;
    }

    // Small delay to be polite
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Total "Load More" clicks: ${clickCount}`);
  console.log(`${'='.repeat(60)}\n`);

  // Extract all case data
  console.log('Extracting case data...');

  const cases = await page.evaluate(() => {
    // Find all h3 elements that contain case study links
    const h3s = document.querySelectorAll('h3');
    const caseH3s = Array.from(h3s).filter(h3 => {
      const link = h3.querySelector('a[href^="/teaching-resources-library/"]');
      return link && !link.href.includes('/mit-sloan-case-studies');
    });

    return caseH3s.map(h3 => {
      const caseData = {};

      // Get the link inside h3
      const titleLink = h3.querySelector('a');
      if (titleLink) {
        caseData.url = titleLink.getAttribute('href');
        if (caseData.url && !caseData.url.startsWith('http')) {
          caseData.url = 'https://mitsloan.mit.edu' + caseData.url;
        }
        caseData.title = titleLink.textContent.trim();
      }

      // Get the parent container (likely a div or article)
      let container = h3.parentElement;

      // Categories - usually in a div before or after the h3
      const categoryDiv = container.querySelector('div');
      if (categoryDiv && !categoryDiv.contains(h3)) {
        caseData.categories = categoryDiv.textContent.trim();
      }

      // Extract paragraphs from the container
      const paragraphs = Array.from(container.querySelectorAll('p'));
      let authors = [];
      let description = '';
      let date = '';

      paragraphs.forEach(p => {
        const text = p.textContent.trim();
        if (text.startsWith('By ')) {
          // Authors
          const authorsText = text.substring(3);
          authors = authorsText.split(',').map(a => a.trim());
        } else if (text.match(/\w+ \d+, \d{4}/)) {
          // Date format like "May 2, 2023"
          date = text;
        } else if (text.length > description.length) {
          // Longest paragraph is probably the description
          description = text;
        }
      });

      caseData.authors = authors;
      caseData.description = description;
      caseData.date = date;

      return caseData;
    });
  });

  await browser.close();

  console.log(`✓ Extracted ${cases.length} cases\n`);

  return cases;
}

async function main() {
  const url = 'https://mitsloan.mit.edu/teaching-resources-library/mit-sloan-case-studies-0';

  try {
    const cases = await fetchAllCases(url);

    // Save to JSON
    const outputFile = 'mit_sloan_cases.json';
    await fs.writeFile(outputFile, JSON.stringify(cases, null, 2), 'utf-8');
    console.log(`✓ Results saved to ${outputFile}`);

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total cases: ${cases.length}`);

    if (cases.length > 0) {
      console.log('\nFirst case:');
      console.log(`  Title: ${cases[0].title || 'N/A'}`);
      console.log(`  Authors: ${cases[0].authors ? cases[0].authors.join(', ') : 'N/A'}`);
      console.log(`  URL: ${cases[0].url || 'N/A'}`);

      console.log('\nLast case:');
      console.log(`  Title: ${cases[cases.length - 1].title || 'N/A'}`);
      console.log(`  Authors: ${cases[cases.length - 1].authors ? cases[cases.length - 1].authors.join(', ') : 'N/A'}`);
      console.log(`  URL: ${cases[cases.length - 1].url || 'N/A'}`);
    }

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
