/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import fs from 'fs-extra';
import path from 'path';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import pLimit from 'p-limit';

puppeteer.use(StealthPlugin());

const SNAPSHOT_CONCURRENCY = 5;
const snapshotLimit = pLimit(SNAPSHOT_CONCURRENCY);

export async function loadQuery(query) {
    const pathName = path.resolve(process.cwd(), 'database', 'queries', `${query.replace(/^\//, '')}.sql`);
    return new Promise(((resolve, reject) => {
        fs.readFile(pathName, (err, data) => {
            if (err) {
                reject(`Failed to load .sql file ${pathName}`);
            } else {
                resolve(data.toString('utf8'));
            }
        });
    }));
}

export async function openPage(url, browser) {
    const page = await browser.newPage();

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 128000 });
        return { browser, page };
    } catch (err) {
        console.warn(` Skipping URL due to error: ${url}\nReason: ${err.message}`);
        return null;
    }
}

export async function getBoundingBoxes(page, source, target, url, click_frequency) {
    const { sourceBoxes, targetBoxes } = await page.evaluate(({ source, target, url, click_frequency }) => {
        function isValidSelector(selector) {
            try { document.querySelectorAll(selector); return true; } catch { return false; }
        }

        function isVisible(el) {
            const style = window.getComputedStyle(el);
            return !(style.display === "none" || style.visibility === "hidden" || style.opacity === "0") &&
                !(el.offsetWidth === 0 || el.offsetHeight === 0);
        }

        function getZInfo(el) {
            const style = window.getComputedStyle(el);
            const z = isNaN(parseInt(style.zIndex)) ? null : parseInt(style.zIndex);
            return { zIndex: z, position: style.position };
        }

        function isOnTop(el) {
            const bbx = el.getBoundingClientRect();
            const points = [
                [bbx.left + 1, bbx.top + 1],
                [bbx.right - 1, bbx.top + 1],
                [bbx.left + 1, bbx.bottom - 1],
                [bbx.right - 1, bbx.bottom - 1],
                [bbx.left + bbx.width / 2, bbx.top + bbx.height / 2]
            ];
            return points.every(([x, y]) => {
                const topEl = document.elementFromPoint(x, y);
                return topEl === el || el.contains(topEl);
            });
        }

        function getSelector(el) {
            if (el.id) return `#${el.id}`;
            if (el.className) return "." + el.className.toString().trim().split(/\s+/).join(".");
            return "No Selector";
        }

        function process(selector, label) {
            if (!isValidSelector(selector)) return [];
            return Array.from(document.querySelectorAll(selector))
                .filter(isVisible)
                .filter(isOnTop)
                .map(el => {
                    const bbx = el.getBoundingClientRect();
                    return {
                        selector: getSelector(el),
                        role: label,
                        url,
                        click_frequency,
                        ...bbx.toJSON(),
                        ...getZInfo(el)
                    };
                });
        }

        const sourceBoxes = process(source, "source");
        let targetBoxes = [];
        if (Array.isArray(target)) {
            target.forEach(t => {
                targetBoxes.push(...process(t, "target"));
            });
        }

        return { sourceBoxes, targetBoxes };
    }, { source, target, url, click_frequency });

    const PADDING = 20;

    const snapshotElements = async (boxes) => {
        const results = await Promise.all(
            boxes.map(box => snapshotLimit(async () => {
                if (box.width > 0 && box.height > 0) {
                    try {
                        const snapshot = await page.screenshot({
                            clip: {
                                x: Math.max(0, box.x - PADDING),
                                y: Math.max(0, box.y - PADDING),
                                width: box.width + PADDING * 2,
                                height: box.height + PADDING * 2
                            },
                            type: 'jpeg',
                            encoding: 'base64'
                        });
                        return { ...box, snapshot: `data:image/jpeg;base64,${snapshot}` };
                    } catch (err) {
                        console.warn(` Failed to capture snapshot for ${box.selector}:`, err.message);
                        return box;
                    }
                } else {
                    return box;
                }
            }))
        );
        return results;
    };

    const sources = await snapshotElements(sourceBoxes);
    const targets = await snapshotElements(targetBoxes);

    if (sources.length === 0 && targets.length === 0) return null;

    return { sources, targets };
}

export async function removeZeros(obj) {
    const res = [];

    obj.forEach((graph) => {
        if (!graph) return;

        const subRes = [];
        const { sources, targets, url } = graph;

        const srcFiltered = (sources || []).filter(objRect => !Object.values(objRect).every(val => val === 0));
        const trgFiltered = (targets || []).filter(objRect => !Object.values(objRect).every(val => val === 0));

        if (srcFiltered.length === 0 && trgFiltered.length === 0) return;

        subRes.push({ sources: srcFiltered, targets: trgFiltered, url });
        res.push(subRes);
    });

    return res;
}

export function findIntersections(sources = [], targets = []) {
    const intersects = [];

    for (const source of sources) {
        for (const target of targets) {
            const doesIntersect = !(
                source.right < target.left ||
                source.left > target.right ||
                source.bottom < target.top ||
                source.top > target.bottom
            );

            if (doesIntersect) {
                intersects.push({
                    source: source.selector,
                    target: target.selector,
                    sourceBox: source,
                    targetBox: target
                });
            }
        }
    }

    return intersects;
}

export function collectConsoleMessages(page) {
    const logs = [];

    page.on('console', (msg) => {
        try {
            const type = msg.type();
            const text = msg.text();

            if (type === 'error') {
                const locations = msg.location?.url
                    ? [`${msg.location.url}:${msg.location.lineNumber}`]
                    : [...text.matchAll(/(https?:\/\/\S+|\b\w+\.js:\d+)/g)].map(m => m[0]);

                logs.push({
                    type,
                    message: text,
                    files: locations
                });
            }
        } catch (err) {
            logs.push({
                type: 'error',
                message: 'Failed to capture console message',
                files: []
            });
        }
    });

    return logs;
}