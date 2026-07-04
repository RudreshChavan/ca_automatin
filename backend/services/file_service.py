"""
MIME type detection and auto-folder assignment logic.
Supports dynamic folder creation for new categories like Software.
"""

# Map MIME type prefixes / patterns to folder names
MIME_TO_FOLDER = {
    "image/": "Images",
    "video/": "Videos",
    "audio/": "Audio",
}

# Specific MIME types that go to Documents
DOCUMENT_MIMES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/rtf",
    "text/plain",
    "text/csv",
    "text/html",
    "text/markdown",
    "application/json",
    "application/xml",
    "text/xml",
}

# Software / Installer MIME types
SOFTWARE_MIMES = {
    "application/x-msdownload",         # .exe
    "application/x-msdos-program",      # .exe
    "application/x-dosexec",            # .exe
    "application/x-executable",         # generic executable
    "application/x-msi",               # .msi
    "application/x-ms-installer",      # .msi
    "application/vnd.android.package-archive",  # .apk
    "application/x-apple-diskimage",    # .dmg
    "application/x-debian-package",     # .deb
    "application/x-rpm",               # .rpm
    "application/java-archive",         # .jar
    "application/x-sharedlib",         # .so
    "application/x-iso9660-image",     # .iso
}

# File extensions fallback mapping
EXT_TO_FOLDER = {
    # Images
    ".jpg": "Images", ".jpeg": "Images", ".png": "Images", ".gif": "Images",
    ".bmp": "Images", ".svg": "Images", ".webp": "Images", ".ico": "Images",
    ".tiff": "Images", ".tif": "Images", ".raw": "Images", ".heic": "Images",
    # Videos
    ".mp4": "Videos", ".avi": "Videos", ".mkv": "Videos", ".mov": "Videos",
    ".wmv": "Videos", ".flv": "Videos", ".webm": "Videos", ".m4v": "Videos",
    # Audio
    ".mp3": "Audio", ".wav": "Audio", ".flac": "Audio", ".aac": "Audio",
    ".ogg": "Audio", ".wma": "Audio", ".m4a": "Audio",
    # Documents
    ".pdf": "Documents", ".doc": "Documents", ".docx": "Documents",
    ".xls": "Documents", ".xlsx": "Documents", ".ppt": "Documents",
    ".pptx": "Documents", ".txt": "Documents", ".csv": "Documents",
    ".rtf": "Documents", ".md": "Documents", ".json": "Documents",
    ".xml": "Documents", ".odt": "Documents", ".ods": "Documents",
    # Software / Installers / Executables
    ".exe": "Software", ".msi": "Software", ".dmg": "Software",
    ".apk": "Software", ".deb": "Software", ".rpm": "Software",
    ".jar": "Software", ".bat": "Software", ".sh": "Software",
    ".cmd": "Software", ".ps1": "Software", ".app": "Software",
    ".iso": "Software", ".appimage": "Software", ".snap": "Software",
    ".dll": "Software", ".so": "Software", ".sys": "Software",
    ".bin": "Software", ".run": "Software", ".com": "Software",
    # Archives / Compressed
    ".zip": "Archives", ".rar": "Archives", ".7z": "Archives",
    ".tar": "Archives", ".gz": "Archives", ".bz2": "Archives",
    ".xz": "Archives", ".tgz": "Archives", ".tar.gz": "Archives",
}

# Archive MIME types
ARCHIVE_MIMES = {
    "application/zip",
    "application/x-zip-compressed",
    "application/x-rar-compressed",
    "application/vnd.rar",
    "application/x-7z-compressed",
    "application/x-tar",
    "application/gzip",
    "application/x-bzip2",
    "application/x-xz",
    "application/x-compressed",
}


def detect_folder(mime_type: str, filename: str = "") -> str:
    """
    Determine the target folder based on MIME type and filename extension.

    Priority:
        1. MIME prefix match (image/*, video/*, audio/*)
        2. Exact MIME match (documents, software, archives)
        3. File extension fallback
        4. Default to "Others"

    Returns folder name. If the folder doesn't exist yet, the caller
    should create it dynamically.
    """
    if mime_type:
        mime_lower = mime_type.lower()

        # Check prefix-based mapping (image/*, video/*, audio/*)
        for prefix, folder in MIME_TO_FOLDER.items():
            if mime_lower.startswith(prefix):
                return folder

        # Check exact document MIME types
        if mime_lower in DOCUMENT_MIMES:
            return "Documents"

        # Check software MIME types
        if mime_lower in SOFTWARE_MIMES:
            return "Software"

        # Check archive MIME types
        if mime_lower in ARCHIVE_MIMES:
            return "Archives"

        # Check if text/* goes to Documents
        if mime_lower.startswith("text/"):
            return "Documents"

    # Fallback to extension
    if filename:
        import os
        _, ext = os.path.splitext(filename.lower())
        if ext in EXT_TO_FOLDER:
            return EXT_TO_FOLDER[ext]

    return "Others"


# ───────────────────────── CA Smart Categorization ─────────────────────────

# Keyword → Category mapping for CA-specific file classification
CA_CATEGORY_KEYWORDS = {
    "GST": ["gst", "gstr", "goods and service", "gstin"],
    "ITR": ["itr", "income tax", "tax return", "income-tax"],
    "Audit": ["audit", "auditor", "audit report"],
    "TDS": ["tds", "tax deducted", "form 16", "form16", "26as", "26 as"],
    "Balance Sheet": ["balance sheet", "balance-sheet", "balance_sheet", "bs report"],
    "P&L": ["p&l", "profit and loss", "profit & loss", "profit-loss", "p&l statement"],
    "Invoice": ["invoice", "bill", "proforma"],
    "Receipt": ["receipt", "payment", "voucher", "challan"],
    "KYC": ["pan", "aadhar", "aadhaar", "kyc", "identity", "voter id", "passport"],
    "Payroll": ["salary", "payroll", "payslip", "pay slip", "wages"],
    "ROC": ["roc", "annual return", "mca", "company filing"],
    "Compliance": ["compliance", "notice", "demand", "assessment"],
    "Bank Statement": ["bank statement", "bank-statement", "account statement"],
    "Agreement": ["agreement", "contract", "mou", "deed"],
}


def detect_category(filename: str, mime_type: str = "") -> str:
    """
    Detect CA-specific category from the file name.
    Matches keywords in the filename against known categories.

    Returns the category string or None if no match.
    """
    if not filename:
        return None

    name_lower = filename.lower()

    for category, keywords in CA_CATEGORY_KEYWORDS.items():
        for kw in keywords:
            if kw in name_lower:
                return category

    return None


# ── CA folder names that match category names ──
CA_FOLDER_MAP = {
    "GST": "GST",
    "ITR": "ITR",
    "Audit": "Audit",
    "TDS": "TDS",
    "Balance Sheet": "Balance Sheet",
    "P&L": "Documents",         # No dedicated folder; keep in Documents
    "Invoice": "Documents",
    "Receipt": "Documents",
    "KYC": "Documents",
    "Payroll": "Documents",
    "ROC": "Documents",
    "Compliance": "Documents",
    "Bank Statement": "Documents",
    "Agreement": "Documents",
}


def detect_ca_folder(filename: str, mime_type: str = "") -> str | None:
    """
    Determine a CA-specific target folder from the filename.
    Returns the folder name (e.g. 'GST', 'ITR') if a match is found,
    or None to fall back to the MIME-type-based folder.
    """
    category = detect_category(filename, mime_type)
    if category and category in CA_FOLDER_MAP:
        return CA_FOLDER_MAP[category]
    return None



# ───────────────────────── AI Data Extraction Hints ─────────────────────────

import re

EXTRACTION_PATTERNS = {
    "GSTIN": r'\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}\b',
    "PAN": r'\b[A-Z]{5}\d{4}[A-Z]{1}\b',
    "Assessment Year": r'\b(AY|FY)\s*[\-]?\s*(\d{4})\s*[\-]?\s*(\d{2,4})\b',
    "Quarter": r'\b[Qq]\s*[\-]?\s*([1-4])\b',
    "Financial Year": r'\b(\d{4})\s*[\-]\s*(\d{2,4})\b',
    "TAN": r'\b[A-Z]{4}\d{5}[A-Z]{1}\b',
}


def extract_document_hints(filename: str, category: str = None) -> dict:
    """Extract structured data hints from filename using regex patterns."""
    if not filename:
        return {}
    hints = {}
    name_upper = filename.upper()
    for field, pattern in EXTRACTION_PATTERNS.items():
        matches = re.findall(pattern, name_upper)
        if matches:
            if isinstance(matches[0], tuple):
                hints[field] = "-".join(matches[0])
            else:
                hints[field] = matches[0]
    if category == "GST":
        for gst_type in ["GSTR-1", "GSTR-2", "GSTR-3B", "GSTR-9", "GSTR-9C"]:
            if gst_type.replace("-", "").lower() in filename.lower().replace("-", "").replace(" ", ""):
                hints["Filing Type"] = gst_type
                break
    elif category == "ITR":
        for form in ["ITR-1", "ITR-2", "ITR-3", "ITR-4", "ITR-5", "ITR-6", "ITR-7"]:
            if form.replace("-", "").lower() in filename.lower().replace("-", "").replace(" ", ""):
                hints["Form Type"] = form
                break
    elif category == "TDS":
        for form in ["Form 16", "Form 16A", "Form 26AS", "Form 24Q", "Form 26Q"]:
            if form.replace(" ", "").lower() in filename.lower().replace(" ", ""):
                hints["Form Type"] = form
                break
    return hints


CATEGORY_ACTIONS = {
    "GST": ["Verify GSTIN matches client records", "Check filing period and due date", "Cross-verify with purchase/sales register"],
    "ITR": ["Verify PAN and assessment year", "Cross-check with Form 26AS/AIS", "Compute tax liability"],
    "Audit": ["Review financial statements", "Verify audit observations", "Check compliance with standards"],
    "TDS": ["Verify TAN of deductor", "Check TDS rates applied", "Reconcile with Form 26AS"],
    "Balance Sheet": ["Verify assets and liabilities", "Check depreciation schedule"],
    "Invoice": ["Verify invoice details and amounts", "Check GST compliance on invoice"],
    "KYC": ["Verify document authenticity", "Check validity/expiry date"],
    "Payroll": ["Verify salary components", "Check TDS deductions"],
}


def suggest_actions(category: str) -> list:
    """Return suggested workflow actions based on document category."""
    if not category:
        return ["Review document and categorize manually"]
    return CATEGORY_ACTIONS.get(category, ["Review and process document"])
