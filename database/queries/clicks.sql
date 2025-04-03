WITH clicks AS (
    SELECT 
        * 
    FROM 
        `helix-225321.helix_rum.cluster` 
    WHERE 
        time BETWEEN TIMESTAMP(@startdate) AND TIMESTAMP(@enddate) 
        AND checkpoint = @checkpoint 
        AND REGEXP_CONTAINS(url, @hostname)
)

SELECT 
    url, -- you want to be able to target urls 
    user_agent, 
    source, 
    (COUNT(*)*weight) AS click_frequency, 
    weight 
FROM 
    clicks 
WHERE 
    NOT REGEXP_CONTAINS(source, r'(button|form|product-details)') --- add some type of schema, document we can pull this list into
GROUP BY 
    url, user_agent, weight, source 
ORDER BY 
    click_frequency DESC