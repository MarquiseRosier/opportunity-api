import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import puppeteer from 'puppeteer-extra';
import fetch from 'node-fetch';
import { openPage, getBoundingBoxes, removeZeros } from './utils/utils.js'

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: '20mb' }));

async function loadBundles(url, date, domainkey, ckpt) {
  const endpoint = `https://bundles.aem.page/bundles/${url}/${date}?domainkey=${domainkey}&checkpoint=${ckpt}`;
  const resp = await fetch(endpoint);
  const data = await resp.json();

  const ret_obj = [];

  data.rumBundles.forEach((item) => {
    const { events, url, userAgent } = item;
    events.forEach((ev) => {
      const { source, checkpoint } = ev;
      if (checkpoint === ckpt) {
        ret_obj.push({
          url,
          user_agent: userAgent,
          source,
          weight: item.weight,
        });
      }
    });
  });

  return ret_obj;
}

async function processBoundingBoxes(dataChunk, browser) {
  const allBbxes = [];

  for (const row of dataChunk) {
    const { url, source, user_agent } = row;
    const result = await openPage(url, browser);
    if (!result) continue;
    const { page } = result;

    try {
      const isMobile = user_agent && user_agent.toLowerCase().includes('mobile');

      if (isMobile) {
        await page.setViewport({ width: 375, height: 812, isMobile: true });
        await page.setUserAgent(user_agent);
      }

      const bbData = await getBoundingBoxes(
        page,
        source,
        ['form', 'button', '.form', '.button'],
        url,
      );
      if (!bbData) continue;

      if (isMobile) {
        for (const src of bbData.sources || []) {
          const elementHandle = await page.$(src.selector);
          if (elementHandle) {
            try {
              const elementBuffer = await elementHandle.screenshot({ encoding: 'base64' });
              await page.evaluate((selector) => {
                const el = document.querySelector(selector);
                if (el) el.scrollIntoView({ behavior: 'instant', block: 'center' });
              }, src.selector);
              const viewportBuffer = await page.screenshot({ encoding: 'base64' });

              src.mobile_snapshots = {
                element_snapshot: `data:image/jpeg;base64,${elementBuffer}`,
                viewport_snapshot: `data:image/jpeg;base64,${viewportBuffer}`
              };
            } catch (err) {
              console.warn(`📸 Failed snapshot for ${src.selector}: ${err.message}`);
            }
          }
        }
      }

      allBbxes.push(bbData);
    } finally {
      await page.close();
    }
  }

  const cleaned = await removeZeros(allBbxes);
  return cleaned.flat();
}

let browser;

(async () => {
  app.get('/get-bboxes/start', async (req, res) => {
    const { domain, checkpoint, domainkey, startdate, enddate } = req.query;
    if (!domain) return res.status(400).json({ error: 'Missing "domain"' });

    if (!browser) {
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    }

    try {
      const start = new Date(startdate);
      const end = new Date(enddate);
      const dateList = [];

      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const formattedDate = d.toISOString().slice(0, 10).replace(/-/g, '/');
        dateList.push(formattedDate);
      }

      const allData = await Promise.all(
        dateList.map(date => loadBundles(domain, date, domainkey, checkpoint))
      );

      const combined = allData.flat();
      const batchSize = 5;
      let cursor = 0;
      let processed = [];

      while (processed.length < batchSize && cursor < combined.length) {
        const chunk = combined.slice(cursor, cursor + 1);
        const result = await processBoundingBoxes(chunk, browser);
        if (result.length > 0) {
          processed.push(...result);
        }
        cursor += 1;
      }

      res.json({
        result: processed,
        raw: combined,
        cursor,
        total: combined.length
      });
    } catch (err) {
      console.error('Error in /start:', err);
      res.status(500).json({ error: err.message || 'Internal Server Error' });
    }
  });

  app.post('/get-bboxes/next', async (req, res) => {
    const { data, cursor, domain, checkpoint, domainkey } = req.body;
    if (!data || !Array.isArray(data)) {
      return res.status(400).json({ error: 'Missing or invalid "data" array in body' });
    }

    if (!domain) return res.status(400).json({ error: 'Missing "domain"' });

    if (!browser) {
      browser = await puppeteer.launch({
        headless: true,
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    }

    try {
      let offset = parseInt(cursor) || 0;
      const batchSize = 5;
      let processed = [];

      while (processed.length < batchSize && offset < data.length) {
        const chunk = data.slice(offset, offset + 1);
        const result = await processBoundingBoxes(chunk, browser);
        if (result.length > 0) {
          processed.push(...result);
        }
        offset += 1;
      }

      res.json({
        result: processed,
        cursor: offset,
        total: data.length
      });
    } catch (err) {
      console.error('Error in /next:', err);
      res.status(500).json({ error: err.message || 'Internal Server Error' });
    }
  });

  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    if (browser) await browser.close();
    process.exit();
  });
})();