import { loadQuery, getBoundingBoxes, openPage, removeZeros } from "./utils/utils.js"
import { DBExecutor } from "./database/db_execute.js"

(async () => {
    const dbx = new DBExecutor()
    await dbx.init()
    const query = await loadQuery('clicks')
    const data = await dbx.execute_query(query)

    const conversion_overlaps = {}
    const asyncDomOverlapFinder = []

    for(let i = 0; i < data.length; i++){
        const { url, source } = data[i];

        // Push the promise itself into the array
        asyncDomOverlapFinder.push(
            openPage(url).then(({browser, page}) => getBoundingBoxes(page, source, ['form', 'button', '.form', '.button']))
        );
    }

    
    // Await all promises in parallel    
    let bbxes = await Promise.all(asyncDomOverlapFinder)
    bbxes = await removeZeros(bbxes)
    console.log(bbxes);
})()