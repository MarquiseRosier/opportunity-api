import express from 'express';
import dotenv from 'dotenv';
import { DBExecutor } from './database/db_execute.js';
import { loadQuery, openPage, getBoundingBoxes, removeZeros, findIntersections, collectConsoleMessages } from './utils/utils.js';
import cors from 'cors';
import puppeteer from 'puppeteer-extra';
import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8001;
app.use(cors());

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function saveSnapshot(sessionId, data) {
  const filePath = path.resolve('./snapshots', `${sessionId}.json`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Snapshot saved: ${filePath}`);
}

export async function loadSnapshot(sessionId) {
  const filePath = path.resolve('./snapshots', `${sessionId}.json`);
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function processBoundingBoxes(dataChunk, browser) {
  const allBbxes = [];

  for (const row of dataChunk) {
    const { url, source, click_frequency, user_agent } = row;
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
        click_frequency
      );
      if (!bbData) continue;

      // Add snapshots if mobile
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

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox'],
  });

  app.get('/get-bboxes/start', async (req, res) => {
    const { hostname, startdate, enddate, checkpoint } = req.query;
    if (!hostname) return res.status(400).json({ error: 'Missing "hostname"' });

    try {
      const dbx = new DBExecutor();
      await dbx.init();

      const queryText = await loadQuery('clicks');
      const data = await dbx.execute_query(queryText, { hostname, startdate, enddate, checkpoint });

      const sessionId = crypto.randomUUID();
      await saveSnapshot(sessionId, data);

      const batchSize = 5;
      let cursor = 0;
      let processed = [];

      while (processed.length < batchSize && cursor < data.length) {
        const chunk = data.slice(cursor, cursor + 1);
        const result = await processBoundingBoxes(chunk, browser);
        if (result.length > 0) {
          processed.push(...result);
        }
        cursor += 1;
      }

      res.json({
        result: processed,
        sessionId,
        total: data.length,
        cursor
      });
    } catch (err) {
      console.error('Error in /start:', err);
      res.status(500).json({ error: err.message || 'Internal Server Error' });
    }
  });

  app.get('/get-bboxes/next', async (req, res) => {
    const { sessionId, cursor } = req.query;
    if (!sessionId) return res.status(400).json({ error: 'Missing "sessionId"' });

    try {
      const snapshot = await loadSnapshot(sessionId);
      let offset = parseInt(cursor) || 0;
      const batchSize = 5;
      let processed = [];

      while (processed.length < batchSize && offset < snapshot.length) {
        const chunk = snapshot.slice(offset, offset + 1);
        const result = await processBoundingBoxes(chunk, browser);
        if (result.length > 0) {
          processed.push(...result);
        }
        offset += 1;
      }

      res.json({
        result: processed,
        sessionId,
        total: snapshot.length,
        cursor: offset
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
    await browser.close();
    process.exit();
  });
})();