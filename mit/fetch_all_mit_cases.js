#!/usr/bin/env node
/**
 * Unified script to fetch ALL MIT Sloan case studies
 * 1. Finds all case study category pages
 * 2. Scrapes all cases from each category
 * 3. Outputs all unique case URLs to a .txt file
 */

const puppeteer = require('puppeteer');
const fs = require('fs').promises;

/**
 * Step 1: Find all case study category pages
 */
async function findCategoryPages(browser) {
  console.log('='.repeat(60));
  console.log('STEP 1: Finding all case study category pages');
  console.log('='.repeat(60));

  const page = await browser.newPage();
  const baseUrl = 'https://mitsloan.mit.edu/teaching-resources-library/case-studies';

  console.log(`\nNavigating to: ${baseUrl}`);
  await page.goto(baseUrl, { waitUntil: 'networkidle2' });

  const categories = await page.evaluate(() => {
    const links = [];
    const seen = new Set();

    document.querySelectorAll('a[href]').forEach(link => {
      const href = link.getAttribute('href');
      const text = link.textContent.trim();

      // Filter for case study category links
      if (href &&
          href.includes('teaching-resources-library') &&
          href.toLowerCase().includes('case') &&
          text) {

        const fullUrl = href.startsWith('http')
          ? href
          : 'https://mitsloan.mit.edu' + href;

        // Avoid duplicates and the main page
        if (!seen.has(fullUrl) &&
            !fullUrl.endsWith('/case-studies') &&
            fullUrl !== 'https://mitsloan.mit.edu/teaching-resources-library/case-studies') {

          seen.add(fullUrl);
          links.push({
            title: text,
            url: fullUrl
          });
        }
      }
    });

    return links;
  });

  await page.close();

  console.log(`\n✓ Found ${categories.length} category pages:`);
  categories.forEach((cat, idx) => {
    console.log(`  ${idx + 1}. ${cat.title}`);
    console.log(`     ${cat.url}`);
  });

  return categories;
}

/**
 * Step 2: Scrape all cases from a single category page
 */
async function scrapeCategoryPage(browser, categoryUrl, categoryTitle) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Scraping: ${categoryTitle}`);
  console.log(`URL: ${categoryUrl}`);
  console.log('='.repeat(60));

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  try {
    await page.goto(categoryUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    console.log('✓ Page loaded');

    let clickCount = 0;

    // Keep clicking "Load More" until all cases are loaded
    while (true) {
      // Count current cases
      const caseCount = await page.evaluate(() => {
        const h3s = document.querySelectorAll('h3');
        const caseH3s = Array.from(h3s).filter(h3 => {
          const link = h3.querySelector('a[href^="/teaching-resources-library/"]');
          return link && !link.href.includes('/mit-sloan-case-studies');
        });
        return caseH3s.length;
      });

      console.log(`Current cases on page: ${caseCount}`);

      // Wait for potential "Load More" button
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

      const casesBeforeClick = caseCount;
      clickCount++;

      console.log(`Clicking "Load More" button (click #${clickCount})...`);

      // Scroll to and click button
      await page.evaluate(el => el.scrollIntoView(), loadMoreButton);
      await new Promise(resolve => setTimeout(resolve, 500));
      await loadMoreButton.click();

      // Wait for new content
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
        console.log('⚠ Timeout waiting for new content');
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`Total "Load More" clicks: ${clickCount}`);

    // Extract all case URLs and data
    const cases = await page.evaluate(() => {
      const h3s = document.querySelectorAll('h3');
      const caseH3s = Array.from(h3s).filter(h3 => {
        const link = h3.querySelector('a[href^="/teaching-resources-library/"]');
        return link && !link.href.includes('/mit-sloan-case-studies');
      });

      return caseH3s.map(h3 => {
        const caseData = {};

        const titleLink = h3.querySelector('a');
        if (titleLink) {
          caseData.url = titleLink.getAttribute('href');
          if (caseData.url && !caseData.url.startsWith('http')) {
            caseData.url = 'https://mitsloan.mit.edu' + caseData.url;
          }
          caseData.title = titleLink.textContent.trim();
        }

        const container = h3.parentElement;

        // Categories
        const categoryDiv = container.querySelector('div');
        if (categoryDiv && !categoryDiv.contains(h3)) {
          caseData.categories = categoryDiv.textContent.trim();
        }

        // Extract paragraphs
        const paragraphs = Array.from(container.querySelectorAll('p'));
        let authors = [];
        let description = '';
        let date = '';

        paragraphs.forEach(p => {
          const text = p.textContent.trim();
          if (text.startsWith('By ')) {
            const authorsText = text.substring(3);
            authors = authorsText.split(',').map(a => a.trim());
          } else if (text.match(/\w+ \d+, \d{4}/)) {
            date = text;
          } else if (text.length > description.length) {
            description = text;
          }
        });

        caseData.authors = authors;
        caseData.description = description;
        caseData.date = date;

        return caseData;
      });
    });

    console.log(`✓ Extracted ${cases.length} cases from this category\n`);

    await page.close();
    return cases;

  } catch (error) {
    console.error(`Error scraping ${categoryTitle}:`, error.message);
    await page.close();
    return [];
  }
}

/**
 * Main function to orchestrate the entire process
 */
async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('MIT SLOAN CASE STUDIES - COMPLETE SCRAPER');
  console.log('='.repeat(60));
  console.log('This script will:');
  console.log('1. Find all case study category pages');
  console.log('2. Scrape all cases from each category');
  console.log('3. Save URLs to all_case_urls.txt');
  console.log('4. Save complete data to all_cases.json');
  console.log('='.repeat(60) + '\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    // Step 1: Find all category pages
    const categories = await findCategoryPages(browser);

    if (categories.length === 0) {
      console.log('\n⚠ No category pages found. Exiting.');
      await browser.close();
      return;
    }

    // Save category list
    await fs.writeFile(
      'case_study_categories.json',
      JSON.stringify(categories, null, 2),
      'utf-8'
    );
    console.log(`\n✓ Category list saved to case_study_categories.json`);

    // Step 2: Scrape each category
    console.log('\n' + '='.repeat(60));
    console.log('STEP 2: Scraping all categories');
    console.log('='.repeat(60));

    const allCases = [];
    const allUrls = new Set();

    for (let i = 0; i < categories.length; i++) {
      const category = categories[i];
      console.log(`\n[${i + 1}/${categories.length}] Processing: ${category.title}`);

      const cases = await scrapeCategoryPage(browser, category.url, category.title);

      cases.forEach(caseData => {
        // Add category info
        caseData.category_page = category.title;
        caseData.category_url = category.url;

        allCases.push(caseData);

        if (caseData.url) {
          allUrls.add(caseData.url);
        }
      });

      // Small delay between categories
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Step 3: Save results
    console.log('\n' + '='.repeat(60));
    console.log('STEP 3: Saving results');
    console.log('='.repeat(60));

    // Remove duplicates based on URL
    const uniqueCases = [];
    const seenUrls = new Set();

    allCases.forEach(caseData => {
      if (caseData.url && !seenUrls.has(caseData.url)) {
        seenUrls.add(caseData.url);
        uniqueCases.push(caseData);
      }
    });

    // Save all case data to JSON
    await fs.writeFile(
      'all_cases.json',
      JSON.stringify(uniqueCases, null, 2),
      'utf-8'
    );
    console.log(`✓ All case data saved to all_cases.json (${uniqueCases.length} unique cases)`);

    // Save URLs to text file
    const urlList = Array.from(allUrls).sort().join('\n');
    await fs.writeFile('all_case_urls.txt', urlList, 'utf-8');
    console.log(`✓ All URLs saved to all_case_urls.txt (${allUrls.size} unique URLs)`);

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(`Categories scraped: ${categories.length}`);
    console.log(`Total cases found: ${allCases.length}`);
    console.log(`Unique cases: ${uniqueCases.length}`);
    console.log(`Unique URLs: ${allUrls.size}`);

    if (uniqueCases.length > 0) {
      console.log('\nSample cases:');
      console.log(`  First: ${uniqueCases[0].title}`);
      console.log(`  Last:  ${uniqueCases[uniqueCases.length - 1].title}`);
    }

    console.log('\n✓ Complete!');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await browser.close();
  }
}

main();
