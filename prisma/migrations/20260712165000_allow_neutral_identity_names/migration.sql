-- Neutral identity terms must not remain active as forbidden-name filters.
UPDATE "ForbiddenName"
SET
    "enabled" = false,
    "deletedAt" = COALESCE("deletedAt", CURRENT_TIMESTAMP),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "compactPattern" IN ('turk', 'türk', 'kurd', 'kürt');

-- Prevent unresolved decisions from removing members after this migration.
UPDATE "NameReview"
SET
    "status" = 'ALLOWED',
    "enforcedAt" = COALESCE("enforcedAt", CURRENT_TIMESTAMP),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE
    "status" IN ('PENDING', 'FORBIDDEN')
    AND "normalizedName" IN ('turk', 'türk', 'kurd', 'kürt');
