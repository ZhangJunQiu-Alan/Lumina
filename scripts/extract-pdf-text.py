#!/usr/bin/env python3
"""
Extract text from a PDF using pdfplumber with automatic two-column detection.
Outputs plain text to stdout; pages are separated by form-feed (\f).
"""

import sys
import re
import pdfplumber

MIN_COLUMN_GAP = 20   # pixels gap needed between columns
MIN_WORDS_PER_COLUMN = 5


def _content_cutoff_top(words):
    """Return the top-y below which footer content (score charts, boilerplate) starts."""
    for w in words:
        if w['text'].lower() in ('if', 'hyou') and w['top'] > 100:
            # Look for nearby 'score' word at similar y
            cutoff_y = w['top']
            nearby = [ww for ww in words if abs(ww['top'] - cutoff_y) <= 8
                      and ww['text'].lower() == 'score']
            if nearby:
                return cutoff_y
    return None


def detect_column_split(words, page_width, page_height=None):
    """
    Return the x midpoint if the page has a clear two-column gap, else None.
    Strategy: build a histogram of word x-starts in the CONTENT area of the page
    (above any score-chart footer), find a wide empty band near the middle.
    Using x0 only (not x1) avoids overlap from long words bridging the gap.
    """
    if len(words) < MIN_WORDS_PER_COLUMN * 2:
        return None

    # Exclude footer area (score charts etc.) which can fill the inter-column gap
    cutoff = _content_cutoff_top(words)
    if cutoff is not None:
        content_words = [w for w in words if w['top'] < cutoff]
    elif page_height:
        content_words = [w for w in words if w['top'] < page_height * 0.70]
    else:
        content_words = words

    if len(content_words) < MIN_WORDS_PER_COLUMN * 2:
        return None

    mid_lo = page_width * 0.35
    mid_hi = page_width * 0.65

    # Use x0 values only — words start in their column, so x0 shows the true gap
    xs = sorted(set(int(w['x0']) for w in content_words))

    # Look for the widest gap within the middle third of the page
    best_gap = 0
    best_mid = None
    for i in range(len(xs) - 1):
        lo, hi = xs[i], xs[i + 1]
        gap = hi - lo
        mid = (lo + hi) / 2
        if mid_lo <= mid <= mid_hi and gap > best_gap and gap >= MIN_COLUMN_GAP:
            best_gap = gap
            best_mid = mid

    return best_mid


def words_to_lines(words):
    """
    Group words into lines by y-coordinate proximity, then sort each line by x.
    """
    if not words:
        return ''

    # First pass: group words into lines by y-proximity (top-to-bottom order)
    sorted_by_y = sorted(words, key=lambda w: w['top'])
    groups: list[list] = []
    current_group: list = []
    current_y = None

    for w in sorted_by_y:
        y = w['top']
        if current_y is None or abs(y - current_y) <= 5:
            current_group.append(w)
            # Update current_y to the average of the group to handle slight drifts
            current_y = sum(ww['top'] for ww in current_group) / len(current_group)
        else:
            if current_group:
                groups.append(current_group)
            current_group = [w]
            current_y = y

    if current_group:
        groups.append(current_group)

    # Second pass: sort each line by x0, then join
    lines = []
    for group in groups:
        group.sort(key=lambda w: w['x0'])
        lines.append(' '.join(w['text'] for w in group))

    return '\n'.join(lines)


def extract_page(page):
    """Extract text from a single page, handling two-column layout."""
    words = page.extract_words(
        x_tolerance=3,
        y_tolerance=3,
        keep_blank_chars=False,
    )

    if not words:
        return ''

    mid_x = detect_column_split(words, page.width, page.height)

    if mid_x:
        left_words = [w for w in words if w['x1'] <= mid_x + 5]
        right_words = [w for w in words if w['x0'] >= mid_x - 5]
        left_text = words_to_lines(left_words)
        right_text = words_to_lines(right_words)
        return left_text + ('\n' if left_text and right_text else '') + right_text
    else:
        return words_to_lines(words)


def main():
    if len(sys.argv) < 2:
        print('Usage: extract-pdf-text.py <pdf_path>', file=sys.stderr)
        sys.exit(1)

    pdf_path = sys.argv[1]
    pages_text = []

    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            pages_text.append(extract_page(page))

    # Join pages with form-feed so normalizePdfText in TS handles it correctly
    sys.stdout.write('\f'.join(pages_text))
    sys.stdout.flush()


if __name__ == '__main__':
    main()
