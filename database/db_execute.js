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

import { getBigQueryClient } from "./bq_client.js";

 export class DBExecutor {
    /**
     * initializes the class with necessary credentials
     */
    constructor(){
        this.secrets = {
            email: process.env.GOOGLE_CLIENT_EMAIL,
            key: process.env.GOOGLE_PRIVATE_KEY,
            project_id: process.env.GOOGLE_PROJECT_ID,
        }
    }

    /**
     * initializes class wide, bigquery client
     */
    async init(){
        this.bigquery = await getBigQueryClient(this.secrets)
    }
    
/**
 * Executes a BigQuery SQL query with named parameters
 * @param {string} query - SQL query with named placeholders (e.g. @userId)
 * @param {Object} params - Object with named parameters (e.g. { userId: 'abc123' })
 * @returns {Promise<Array<object>>}
 */
async execute_query(query, params = {}) {

    console.log('🧠 Debug SQL:\n' + substituteParams(query, params));
    return new Promise((resolve, reject) => {
        const queryOptions = {
            query: query,
            params: params,
            location: 'US', // or your region
            parameterMode: 'named', // Use named parameters like @foo
        };

        this.bigquery.query(queryOptions, (err, rows) => {
            if (err) {
                reject({ status: 500, message: `Query failed: ${err.message}` });
            } else {
                resolve(rows);
            }
        });
    });}
}

function substituteParams(query, params = {}) {
    let substituted = query;
    for (const [key, value] of Object.entries(params)) {
        const val = typeof value === 'string' ? `'${value}'` : value;
        substituted = substituted.replace(new RegExp(`@${key}\\b`, 'g'), val);
    }
    return substituted;
}
