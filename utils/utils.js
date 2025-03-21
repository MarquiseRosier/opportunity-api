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
import puppeteer from 'puppeteer';
import { JSDOM } from 'jsdom'

/**
 * reads a query file and loads it into memory
 *
 * @param {string} query name of the query file
 */
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

/**
 * open a web page using puppeteer
 * @param {*} url 
 */
export async function openPage(url) {
    const browser = await puppeteer.launch({
        headless: false,  // 👀 Run with a visible browser
    });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' }); // Ensure DOM is loaded

   return { browser, page }
}

/**
 * 
 * @param {*} dom 
 * @param {*} source 
 * @param {*} target 
 */
export async function getBoundingBoxes(page, source, target) {
    return await page.evaluate(({ source, target }) => {
        const result = {};

        function isVisible(el) {
            const bbx = el.getBoundingClientRect();

            const inViewport =
                bbx.width > 0 &&
                bbx.height > 0 &&
                bbx.bottom > 0 &&
                bbx.right > 0 &&
                bbx.top < window.innerHeight &&
                bbx.left < window.innerWidth;

            const style = window.getComputedStyle(el);
            const isHidden =
                style.display === "none" ||
                style.visibility === "hidden" ||
                style.opacity === "0";

            const hasZeroSize = el.offsetWidth === 0 || el.offsetHeight === 0;

            const centerX = bbx.left + bbx.width / 2;
            const centerY = bbx.top + bbx.height / 2;
            const topElement = document.elementFromPoint(centerX, centerY);
            const isObstructed = topElement && topElement !== el;

            return !isHidden && !hasZeroSize
        }

        const sourceElements = document.querySelectorAll(source);
        console.log(`Checking source elements:`, sourceElements);

        if (sourceElements.length > 0) {
            result.sources = Array.from(sourceElements)
                .filter(isVisible)  //Only include visible elements
                .map(el => {
                    const bbx = el.getBoundingClientRect();
                    console.log(`Visible BBX for ${source}:`, bbx);
                    return {
                        ...bbx.toJSON(),
                        selector: el.id
                            ? `#${el.id}` // If an ID exists, prefix it with #
                            : el.className
                            ? `.${el.className.split(" ").join(".")}` // If a class exists, prefix with .
                            : "No Selector" // Fallback if neither exist
                    };                });
        } else {
            result.sources = [];
            console.warn(`No visible elements found for selector: ${source}`);
        }

        result.targets = [];
        target.forEach(targ => {
            const targetElements = document.querySelectorAll(targ);
            console.log(`Checking target elements for ${targ}:`, targetElements);

            const visibleTargets = Array.from(targetElements)
                .filter(isVisible) 
                .map(el => {
                    const bbx = el.getBoundingClientRect();
                    console.log(`Visible BBX for ${targ}:`, bbx);
                    return {
                        ...bbx.toJSON(),
                        selector: el.id
                            ? `#${el.id}` 
                            : el.className
                            ? `.${el.className.split(" ").join(".")}` 
                            : "No Selector" 
                    };
                });

            result.targets.push(...visibleTargets); 
        });

        return result;
    }, { source, target });
}

export async function removeZeros(obj) {
    const res = []

    obj.forEach((graph) => {
        const subRes = []

        const { sources, targets } = graph;
        const srcFiltered = Object.values(sources).filter(objRect => !Object.values(objRect).every(value => value === 0))
        const trgFiltered = Object.values(targets).filter(objRect => !Object.values(objRect).every(value => value === 0))

        subRes.push({sources: srcFiltered, targets: trgFiltered})

        res.push(subRes)
    })
    return res;
}
