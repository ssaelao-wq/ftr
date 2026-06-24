// Configuration file for project-wide settings

module.exports = {
    // List of PartNames from ZIM that require the "ZIM - 02" prefix.
    // Wording is checked case-insensitively, and leading/trailing spaces are trimmed.
    ZIM_PART_NAME_LIST: [
        "Glue Stain Cleaning",
        "Oil Stain Cleaning",
        "Special Treatment Charge/Lashing Gear/Garbage",
        "Special Treatment Charge/Lashing Gears/Garbage",
        "Remove Nail",
        "Remove DG Sticker"
    ],

    // Cleanup Configuration (retention days for different types of data)
    CLEANUP_SETTINGS: {
        PDF_MAX_DAYS: parseInt(process.env.PDF_MAX_DAYS) || 180,
        INVOICE_MAX_DAYS: parseInt(process.env.INVOICE_MAX_DAYS) || 180,
        LOG_MAX_DAYS: parseInt(process.env.LOG_MAX_DAYS) || 60,
        TEMP_FILES_MAX_DAYS: parseInt(process.env.TEMP_FILES_MAX_DAYS) || 1
    }
};
