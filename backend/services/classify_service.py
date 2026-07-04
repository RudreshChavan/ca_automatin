"""
AI-Powered Document Classification & Routing Engine.

Analyzes uploaded files using filename, extracted text (PDF), and metadata
to classify into CA-specific categories with confidence scoring.
"""

import re
import os
import json
from datetime import datetime


# ═══════════════════════════════════════════════════════════
# CLASSIFICATION RULES — 7 Categories, 40+ Sub-categories
# ═══════════════════════════════════════════════════════════

CLASSIFICATION_RULES = {
    # ── 1. TAX FILES ──
    "GST": {
        "GSTR1": {
            "keywords": ["gstr1", "gstr-1", "gstr 1"],
            "weight": 10,
        },
        "GSTR3B": {
            "keywords": ["gstr3b", "gstr-3b", "gstr 3b"],
            "weight": 10,
        },
        "GSTR9": {
            "keywords": ["gstr9", "gstr-9", "gstr 9", "annual return gst"],
            "weight": 10,
        },
        "EWAY_BILL": {
            "keywords": ["e-way bill", "eway bill", "e way bill", "eway"],
            "weight": 9,
        },
        "INVOICE": {
            "keywords": ["tax invoice", "gst invoice"],
            "weight": 7,
        },
    },
    "INCOME_TAX": {
        "ITR": {
            "keywords": ["itr", "income tax return", "itr-1", "itr-2", "itr-3",
                         "itr-4", "itr-5", "itr-6", "itr-7", "itr1", "itr2",
                         "itr3", "itr4", "itr5", "itr6", "itr7"],
            "weight": 10,
        },
        "ADVANCE_TAX": {
            "keywords": ["advance tax", "advance-tax", "advance_tax"],
            "weight": 9,
        },
        "SELF_ASSESSMENT": {
            "keywords": ["self assessment tax", "self-assessment", "self_assessment",
                         "self assessment"],
            "weight": 9,
        },
    },
    "TDS": {
        "FORM_24Q": {
            "keywords": ["form 24q", "form24q", "24q"],
            "weight": 10,
        },
        "FORM_26Q": {
            "keywords": ["form 26q", "form26q", "26q"],
            "weight": 10,
        },
        "FORM_27Q": {
            "keywords": ["form 27q", "form27q", "27q"],
            "weight": 10,
        },
        "TDS_RETURN": {
            "keywords": ["tds", "tax deducted at source", "tds return"],
            "weight": 7,
        },
    },

    # ── 2. FINANCIAL STATEMENTS ──
    "FINANCIALS": {
        "BALANCE_SHEET": {
            "keywords": ["balance sheet", "balance-sheet", "balance_sheet",
                         "statement of financial position"],
            "weight": 10,
        },
        "PNL": {
            "keywords": ["profit and loss", "profit & loss", "p&l", "p & l",
                         "profit-loss", "income statement", "pnl",
                         "statement of profit"],
            "weight": 10,
        },
        "CASH_FLOW": {
            "keywords": ["cash flow", "cash-flow", "cash_flow",
                         "statement of cash flows"],
            "weight": 10,
        },
        "TRIAL_BALANCE": {
            "keywords": ["trial balance", "trial-balance", "trial_balance"],
            "weight": 10,
        },
        "LEDGER": {
            "keywords": ["ledger", "general ledger", "account ledger",
                         "ledger account"],
            "weight": 8,
        },
    },

    # ── 3. AUDIT FILES ──
    "AUDIT": {
        "REPORT": {
            "keywords": ["audit report", "auditor report", "auditors report",
                         "statutory audit"],
            "weight": 10,
        },
        "TAX_AUDIT": {
            "keywords": ["form 3cd", "form3cd", "3cd", "tax audit",
                         "form 3ca", "form 3cb"],
            "weight": 10,
        },
        "INTERNAL": {
            "keywords": ["internal audit", "internal-audit"],
            "weight": 9,
        },
        "COMPLIANCE": {
            "keywords": ["compliance checklist", "compliance check",
                         "compliance report", "compliance audit"],
            "weight": 9,
        },
    },

    # ── 4. CLIENT INPUT DOCUMENTS ──
    "CLIENT_UPLOADS": {
        "BANK": {
            "keywords": ["bank statement", "bank-statement", "bank_statement",
                         "account statement", "bank passbook"],
            "weight": 10,
        },
        "PURCHASE": {
            "keywords": ["purchase invoice", "purchase bill", "purchase order",
                         "purchase-invoice"],
            "weight": 9,
        },
        "SALES": {
            "keywords": ["sales invoice", "sales bill", "sales register",
                         "sales-invoice"],
            "weight": 9,
        },
        "EXPENSE": {
            "keywords": ["expense bill", "expense receipt", "expense report",
                         "expense voucher", "expense-bill"],
            "weight": 9,
        },
        "SALARY": {
            "keywords": ["salary slip", "salary certificate", "salary statement"],
            "weight": 9,
        },
        "RENT": {
            "keywords": ["rent agreement", "rental agreement", "lease agreement",
                         "rent receipt", "lease deed"],
            "weight": 9,
        },
        "INVESTMENT": {
            "keywords": ["investment proof", "investment declaration",
                         "80c proof", "80d proof", "investment-proof",
                         "insurance premium", "ppf", "elss", "nsc"],
            "weight": 8,
        },
        "LOAN": {
            "keywords": ["loan statement", "loan account", "emi schedule",
                         "loan sanction", "loan-statement"],
            "weight": 9,
        },
    },

    # ── 5. CORPORATE & LEGAL ──
    "LEGAL": {
        "COI": {
            "keywords": ["certificate of incorporation", "incorporation certificate",
                         "coi", "certificate-of-incorporation"],
            "weight": 10,
        },
        "MOA": {
            "keywords": ["memorandum of association", "moa"],
            "weight": 10,
        },
        "AOA": {
            "keywords": ["articles of association", "aoa"],
            "weight": 10,
        },
        "BOARD": {
            "keywords": ["board resolution", "board meeting", "board minutes",
                         "board-resolution"],
            "weight": 9,
        },
        "SHAREHOLDER": {
            "keywords": ["shareholder agreement", "shareholders agreement",
                         "sha", "share subscription"],
            "weight": 9,
        },
        "PARTNERSHIP": {
            "keywords": ["partnership deed", "partnership agreement",
                         "llp agreement"],
            "weight": 9,
        },
        "MCA": {
            "keywords": ["aoc-4", "aoc4", "mgt-7", "mgt7", "mca filing",
                         "roc filing", "annual return mca", "dir-3",
                         "dir3", "inc-22", "inc22"],
            "weight": 10,
        },
    },

    # ── 6. PAYROLL FILES ──
    "PAYROLL": {
        "PAYSLIP": {
            "keywords": ["payslip", "pay slip", "pay-slip", "salary slip payroll"],
            "weight": 10,
        },
        "FORM16": {
            "keywords": ["form 16", "form16", "form-16", "form 16a", "form16a"],
            "weight": 10,
        },
        "FORM12BA": {
            "keywords": ["form 12ba", "form12ba", "form-12ba", "12ba"],
            "weight": 10,
        },
        "ATTENDANCE": {
            "keywords": ["attendance", "attendance register", "attendance sheet",
                         "attendance report"],
            "weight": 8,
        },
        "PF_ESIC": {
            "keywords": ["provident fund", "pf challan", "pf return",
                         "epf", "esic", "esi", "pf contribution",
                         "pf statement"],
            "weight": 9,
        },
    },

    # ── 7. KYC / SUPPORTING ──
    "KYC": {
        "GST_CERT": {
            "keywords": ["gst certificate", "gst registration", "gstin certificate",
                         "gst reg"],
            "weight": 10,
        },
        "PAN": {
            "keywords": ["pan card", "pan copy", "permanent account number"],
            "weight": 9,
        },
        "AADHAAR": {
            "keywords": ["aadhaar", "aadhar", "aadhaar card", "uid card"],
            "weight": 9,
        },
        "DSC": {
            "keywords": ["digital signature", "dsc", "digital-signature",
                         "dsc certificate"],
            "weight": 9,
        },
        "AUTH": {
            "keywords": ["authorization letter", "authorisation letter",
                         "authority letter", "power of attorney", "poa"],
            "weight": 8,
        },
    },
}


# ═══════════════════════════════════════════════════════════
# FINANCIAL YEAR & MONTH DETECTION
# ═══════════════════════════════════════════════════════════

# Indian FY: April–March (e.g., FY 2024-25 = April 2024 – March 2025)
FY_PATTERNS = [
    # "FY 2024-25", "FY2024-25", "FY 2024-2025"
    re.compile(r'\b(?:FY|fy)\s*[:\-]?\s*(\d{4})\s*[\-\/]\s*(\d{2,4})\b'),
    # "AY 2025-26"
    re.compile(r'\b(?:AY|ay)\s*[:\-]?\s*(\d{4})\s*[\-\/]\s*(\d{2,4})\b'),
    # "2024-25" standalone year range
    re.compile(r'\b(20\d{2})\s*[\-]\s*(\d{2})\b'),
    # "2024-2025"
    re.compile(r'\b(20\d{2})\s*[\-]\s*(20\d{2})\b'),
]

MONTH_NAMES = {
    "january": "01", "jan": "01",
    "february": "02", "feb": "02",
    "march": "03", "mar": "03",
    "april": "04", "apr": "04",
    "may": "05",
    "june": "06", "jun": "06",
    "july": "07", "jul": "07",
    "august": "08", "aug": "08",
    "september": "09", "sep": "09", "sept": "09",
    "october": "10", "oct": "10",
    "november": "11", "nov": "11",
    "december": "12", "dec": "12",
}

# Quarter → month mapping (start month of the quarter)
QUARTER_MAP = {
    "q1": "04", "q2": "07", "q3": "10", "q4": "01",
}


def detect_financial_year(text: str) -> str | None:
    """
    Detect financial year from text.
    Returns format: 'FY2024-25' or None.
    """
    if not text:
        return None

    for pattern in FY_PATTERNS:
        match = pattern.search(text)
        if match:
            start_year = match.group(1)
            end_part = match.group(2)

            # Normalize end year
            if len(end_part) == 2:
                end_year = end_part
            else:
                end_year = end_part[2:]  # Take last 2 digits

            return f"FY{start_year}-{end_year}"

    # Fallback: look for a standalone 4-digit year
    year_match = re.search(r'\b(20\d{2})\b', text)
    if year_match:
        year = int(year_match.group(1))
        now = datetime.now()
        # Determine FY based on Indian convention (April start)
        if now.month >= 4:
            return f"FY{year}-{str(year + 1)[2:]}"
        else:
            return f"FY{year - 1}-{str(year)[2:]}"

    return None


def detect_month(text: str) -> str | None:
    """
    Detect month from text (month name or quarter).
    Returns month number as 2-digit string ('01'–'12') or None.
    """
    if not text:
        return None

    text_lower = text.lower()

    # Check month names
    for month_name, month_num in MONTH_NAMES.items():
        if month_name in text_lower:
            return month_num

    # Check quarters
    for quarter, month_num in QUARTER_MAP.items():
        if quarter in text_lower:
            return month_num

    return None


def get_current_financial_year() -> str:
    """Get the current Indian financial year string."""
    now = datetime.now()
    if now.month >= 4:
        return f"FY{now.year}-{str(now.year + 1)[2:]}"
    else:
        return f"FY{now.year - 1}-{str(now.year)[2:]}"


# ═══════════════════════════════════════════════════════════
# PDF TEXT EXTRACTION
# ═══════════════════════════════════════════════════════════

def extract_text_from_pdf(file_path: str, max_pages: int = 5) -> str:
    """
    Extract text content from a PDF file using PyPDF2.
    Reads up to max_pages to keep it fast.
    Returns extracted text or empty string on failure.
    """
    try:
        from PyPDF2 import PdfReader

        reader = PdfReader(file_path)
        text_parts = []
        pages_to_read = min(len(reader.pages), max_pages)

        for i in range(pages_to_read):
            page_text = reader.pages[i].extract_text()
            if page_text:
                text_parts.append(page_text)

        return " ".join(text_parts)
    except Exception as e:
        print(f"[Classify] PDF text extraction failed for {file_path}: {e}")
        return ""


# ═══════════════════════════════════════════════════════════
# CORE CLASSIFICATION ENGINE
# ═══════════════════════════════════════════════════════════

def _count_keyword_matches(text: str, keywords: list) -> int:
    """Count how many keyword occurrences are found in the text."""
    text_lower = text.lower()
    count = 0
    for kw in keywords:
        # Count occurrences (not just presence)
        count += text_lower.count(kw.lower())
    return count


def classify_document(
    filename: str,
    file_path: str = None,
    mime_type: str = "",
    client_name: str = "Unknown",
    client_id: int = 0,
) -> dict:
    """
    Main classification function.

    Analyzes the file using:
      1. Filename keywords
      2. Extracted text (PDF content)
      3. Metadata (MIME type)

    Returns a strict JSON-compatible dict:
    {
        "category": str,
        "sub_category": str,
        "financial_year": str,
        "month": str,
        "confidence_score": int (0-100),
        "suggested_file_name": str,
        "folder_path": str,
        "needs_review": bool,
        "matched_keywords": list,
        "source": str  ("filename" | "content" | "both")
    }
    """

    # ── Gather text sources ──
    filename_clean = os.path.splitext(filename)[0] if filename else ""
    # Replace underscores/hyphens with spaces for better keyword matching
    filename_text = filename_clean.replace("_", " ").replace("-", " ")

    content_text = ""
    if file_path and os.path.isfile(file_path):
        ext = os.path.splitext(file_path)[1].lower()
        if ext == ".pdf":
            content_text = extract_text_from_pdf(file_path)

    # Combined text for analysis (content is prioritized over filename)
    combined_text = f"{filename_text} {content_text}"

    # ── Score each category/sub-category ──
    best_match = None
    best_score = 0
    all_matches = []

    for category, sub_categories in CLASSIFICATION_RULES.items():
        for sub_cat, rule in sub_categories.items():
            keywords = rule["keywords"]
            weight = rule["weight"]

            # Score from filename
            fn_matches = _count_keyword_matches(filename_text, keywords)
            fn_score = fn_matches * weight * 2  # Filename matches worth double

            # Score from content
            ct_matches = _count_keyword_matches(content_text, keywords)
            ct_score = ct_matches * weight

            total_score = fn_score + ct_score

            if total_score > 0:
                source = "both" if fn_matches > 0 and ct_matches > 0 else (
                    "filename" if fn_matches > 0 else "content"
                )
                matched_kws = [kw for kw in keywords
                               if kw.lower() in combined_text.lower()]

                all_matches.append({
                    "category": category,
                    "sub_category": sub_cat,
                    "score": total_score,
                    "source": source,
                    "matched_keywords": matched_kws,
                })

                if total_score > best_score:
                    best_score = total_score
                    best_match = {
                        "category": category,
                        "sub_category": sub_cat,
                        "score": total_score,
                        "source": source,
                        "matched_keywords": matched_kws,
                    }

    # ── Calculate confidence ──
    if best_match:
        # Base confidence from score
        raw_confidence = min(best_score * 10, 100)

        # Boost if matched in both filename and content
        if best_match["source"] == "both":
            raw_confidence = min(raw_confidence + 15, 100)

        # Boost if multiple keywords matched
        num_kws = len(best_match["matched_keywords"])
        if num_kws >= 3:
            raw_confidence = min(raw_confidence + 10, 100)
        elif num_kws >= 2:
            raw_confidence = min(raw_confidence + 5, 100)

        # Penalize if there are close competing matches
        if len(all_matches) > 1:
            sorted_matches = sorted(all_matches, key=lambda x: x["score"], reverse=True)
            if len(sorted_matches) > 1:
                ratio = sorted_matches[1]["score"] / sorted_matches[0]["score"]
                if ratio > 0.7:
                    raw_confidence = max(raw_confidence - 15, 30)

        confidence = int(raw_confidence)
        category = best_match["category"]
        sub_category = best_match["sub_category"]
        source = best_match["source"]
        matched_keywords = best_match["matched_keywords"]
    else:
        confidence = 0
        category = "UNCATEGORIZED"
        sub_category = "UNKNOWN"
        source = "none"
        matched_keywords = []

    # ── Detect financial year and month ──
    financial_year = detect_financial_year(combined_text)
    if not financial_year:
        financial_year = get_current_financial_year()

    month = detect_month(combined_text)

    # ── Generate standardized file name ──
    safe_client = re.sub(r'[^a-zA-Z0-9]', '', client_name.split("@")[0].title())
    if not safe_client:
        safe_client = "Client"

    doc_type = f"{category}_{sub_category}" if category != "UNCATEGORIZED" else "DOC"
    ext = os.path.splitext(filename)[1] if filename else ".pdf"
    month_suffix = f"_{month}" if month else ""
    suggested_name = f"{safe_client}_{doc_type}_{financial_year}{month_suffix}{ext}"

    # ── Generate folder path ──
    folder_path = f"clients/{client_id}/{category}/{financial_year}/{sub_category}/"

    # ── Determine if manual review is needed ──
    needs_review = confidence < 80

    return {
        "category": category,
        "sub_category": sub_category,
        "financial_year": financial_year,
        "month": month or "",
        "confidence_score": confidence,
        "suggested_file_name": suggested_name,
        "folder_path": folder_path,
        "needs_review": needs_review,
        "matched_keywords": matched_keywords,
        "source": source,
    }


def reclassify_document(
    filename: str,
    file_path: str = None,
    mime_type: str = "",
    client_name: str = "Unknown",
    client_id: int = 0,
) -> dict:
    """
    Re-classify an existing document. Same logic as classify_document.
    Called when admin triggers reclassification of existing files.
    """
    return classify_document(filename, file_path, mime_type, client_name, client_id)


def get_all_categories() -> dict:
    """
    Return the full classification rules structure for frontend display.
    """
    result = {}
    for category, sub_categories in CLASSIFICATION_RULES.items():
        result[category] = list(sub_categories.keys())
    return result


def get_category_display_name(category: str) -> str:
    """Human-readable category name."""
    display_map = {
        "GST": "GST (Tax)",
        "INCOME_TAX": "Income Tax",
        "TDS": "TDS",
        "FINANCIALS": "Financial Statements",
        "AUDIT": "Audit Files",
        "CLIENT_UPLOADS": "Client Documents",
        "LEGAL": "Corporate & Legal",
        "PAYROLL": "Payroll Files",
        "KYC": "KYC / Supporting",
        "UNCATEGORIZED": "Uncategorized",
    }
    return display_map.get(category, category)
