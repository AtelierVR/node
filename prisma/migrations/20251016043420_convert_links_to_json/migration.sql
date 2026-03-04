-- This is an auto-generated migration file
-- Convert links from String[] to Json format with {label, value} objects

-- Step 1: Add a new column for the JSON links
ALTER TABLE "User" ADD COLUMN "links_new" JSONB DEFAULT '[]'::jsonb;

-- Step 2: Convert existing string array links to JSON format
-- Each string becomes {label: string, value: string} where label is extracted from URL or set to the URL
UPDATE "User" 
SET "links_new" = (
    SELECT jsonb_agg(
        jsonb_build_object(
            'label', 
            CASE 
                WHEN link ~ '^https?://([^/]+)' THEN 
                    regexp_replace(link, '^https?://([^/]+).*', '\1')
                ELSE 
                    link
            END,
            'value', link
        )
    )
    FROM unnest("User".links) AS link
)
WHERE "User".links IS NOT NULL AND array_length("User".links, 1) > 0;

-- Step 3: Drop the old links column
ALTER TABLE "User" DROP COLUMN "links";

-- Step 4: Rename the new column to links
ALTER TABLE "User" RENAME COLUMN "links_new" TO "links";