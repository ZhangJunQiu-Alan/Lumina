#!/usr/bin/env python3
"""
Extract Cambridge IELTS Listening paper page metadata and answer hotspot positions.

This script reads the PDF text layer with pdfplumber and returns JSON on stdout.
It does not render images or write files; the TypeScript importer owns rendering,
uploading, and database writes.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from typing import Any

import pdfplumber


DOT_RE = re.compile(r"[.\u00b7\u2022·•]{3,}")
RANGE_RE = re.compile(r"\bQuestions?[\s~:.-]*([0-9](?:\s*[0-9Oo])?)(?:\s*(?::?\s*-|:-|-|to|and|&)\s*([0-9](?:\s*[0-9Oo])?))?", re.I)


@dataclass
class Line:
    words: list[dict[str, Any]]
    text: str
    x0: float
    x1: float
    top: float
    bottom: float


def clean_token(value: str) -> str:
    return re.sub(r"[^0-9]", "", value)


def parse_range_token(value: str) -> int:
    return int(re.sub(r"\s+", "", value).replace("O", "0").replace("o", "0"))


def normalize_text_markers(value: str) -> str:
    value = re.sub(r"L\s*I\s*S\s*T\s*E\s*N\s*I\s*N\s*G", "LISTENING", value, flags=re.I)
    value = re.sub(r"S\s*e\s*c\s*t\s*i\s*o\s*n", "Section", value, flags=re.I)
    value = re.sub(r"Q\s*u\s*e\s*s\s*t\s*i\s*o\s*n\s*s", "Questions", value, flags=re.I)
    value = value.replace("＋", "-").replace("+", "-").replace("^", "-").replace("一", "-").replace("—", "-").replace("–", "-")
    return value


def page_key(pdf_page: int) -> str:
    return f"p{pdf_page:03d}"


def storage_path(book_number: int, test_number: int, section_number: int, pdf_page: int) -> str:
    return f"cambridge-{book_number}/test-{test_number}/section-{section_number}/page-{pdf_page:03d}.jpg"


def group_lines(words: list[dict[str, Any]]) -> list[Line]:
    if not words:
        return []

    groups: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    current_y: float | None = None

    for word in sorted(words, key=lambda item: (item["top"], item["x0"])):
        y = float(word["top"])
        if current_y is None or abs(y - current_y) <= 5:
            current.append(word)
            current_y = sum(float(item["top"]) for item in current) / len(current)
        else:
            groups.append(current)
            current = [word]
            current_y = y

    if current:
        groups.append(current)

    lines: list[Line] = []
    for group in groups:
        ordered = sorted(group, key=lambda item: item["x0"])
        lines.append(Line(
            words=ordered,
            text=" ".join(str(item["text"]) for item in ordered),
            x0=min(float(item["x0"]) for item in ordered),
            x1=max(float(item["x1"]) for item in ordered),
            top=min(float(item["top"]) for item in ordered),
            bottom=max(float(item["bottom"]) for item in ordered),
        ))
    return lines


def line_from_ocr(raw_line: dict[str, Any], page_width: float, page_height: float) -> Line:
    text = str(raw_line.get("text", ""))
    x0 = float(raw_line.get("x", 0)) * page_width
    top = float(raw_line.get("y", 0)) * page_height
    width = max(1.0, float(raw_line.get("width", 0)) * page_width)
    height = max(1.0, float(raw_line.get("height", 0)) * page_height)
    tokens = text.split()
    words: list[dict[str, Any]] = []
    cursor = x0
    total_chars = max(1, sum(len(token) for token in tokens))
    for token in tokens:
        token_width = max(8.0, width * (len(token) / total_chars) * 0.82)
        words.append({
            "text": token,
            "x0": cursor,
            "x1": min(x0 + width, cursor + token_width),
            "top": top,
            "bottom": top + height,
        })
        cursor += token_width + 4
    if not words:
        words = [{"text": text, "x0": x0, "x1": x0 + width, "top": top, "bottom": top + height}]
    return Line(words=words, text=text, x0=x0, x1=x0 + width, top=top, bottom=top + height)


def load_ocr_pages(ocr_json_path: str | None) -> list[dict[str, Any]]:
    if not ocr_json_path:
        return []
    try:
        with open(ocr_json_path, "r", encoding="utf-8") as file:
            payload = json.load(file)
    except FileNotFoundError:
        return []

    pages: list[dict[str, Any]] = []
    for page in payload.get("pages", []):
        page_width = float(page.get("width") or 1)
        page_height = float(page.get("height") or 1)
        lines = [line_from_ocr(line, page_width, page_height) for line in page.get("lines", [])]
        pages.append({
            "pdfPage": int(page.get("pageNumber")),
            "pageKey": page_key(int(page.get("pageNumber"))),
            "width": page_width,
            "height": page_height,
            "lines": lines,
            "text": normalize_text_markers("\n".join(line.text for line in lines)),
        })
    return pages


def extract_ranges(text: str) -> list[tuple[int, int]]:
    ranges: list[tuple[int, int]] = []
    for match in RANGE_RE.finditer(text):
        start = parse_range_token(match.group(1))
        end = parse_range_token(match.group(2) or match.group(1))
        if start == 17 and end == 30:
            start = 27
        if 1 <= start <= 40 and 1 <= end <= 40:
            ranges.append((start, max(start, end)))
    return ranges


def extract_line_question_numbers(lines: list[Line]) -> list[int]:
    numbers: list[int] = []
    for line in lines:
        if not line.words:
            continue
        token = clean_token(str(line.words[0]["text"]))
        if not token:
            continue
        value = int(token)
        if 1 <= value <= 40 and line.top < 620:
            numbers.append(value)
    return numbers


def question_section(question_number: int) -> int:
    return ((question_number - 1) // 10) + 1


def input_kind(question_type: str, answers: list[str]) -> str:
    if question_type in ("multiple_choice_single", "matching"):
        if answers and all(re.fullmatch(r"[A-H]", answer.strip(), re.I) for answer in answers):
            return "choice"
    return "text"


def word_matches_question(word: dict[str, Any], question_number: int) -> bool:
    token = clean_token(str(word["text"]))
    return token == str(question_number)


def line_question_word(line: Line, question_number: int) -> dict[str, Any] | None:
    for word in line.words:
        if word_matches_question(word, question_number):
            return word
    return None


def has_dots(line: Line) -> bool:
    return DOT_RE.search(line.text) is not None


def score_line(line: Line, question_number: int, page_height: float, kind: str) -> int:
    q_word = line_question_word(line, question_number)
    if not q_word:
        return -1000

    score = 0
    first_token = clean_token(str(line.words[0]["text"])) if line.words else ""
    if first_token == str(question_number):
        score += 35
    if has_dots(line):
        score += 40
    if kind == "choice" and re.search(r"\b[A-H]\b", line.text):
        score += 5
    if re.search(r"\bQuestions?\b", line.text, re.I):
        score -= 45
    if line.top > page_height - 50:
        score -= 60
    return score


def dotted_bounds_after_question(line: Line, question_number: int) -> tuple[float, float] | None:
    q_word = line_question_word(line, question_number)
    if not q_word:
        return None

    dots = [
        word for word in line.words
        if float(word["x0"]) >= float(q_word["x1"]) - 1 and DOT_RE.search(str(word["text"]))
    ]
    if not dots:
        dots = [word for word in line.words if DOT_RE.search(str(word["text"]))]
    if not dots:
        return None
    return min(float(word["x0"]) for word in dots), max(float(word["x1"]) for word in dots)


def make_hotspot(
    line: Line,
    page: dict[str, Any],
    question: dict[str, Any],
    kind: str,
    fallback_index: int,
) -> dict[str, Any]:
    page_width = float(page["width"])
    page_height = float(page["height"])
    question_number = int(question["questionNumber"])
    dot_bounds = dotted_bounds_after_question(line, question_number)
    if dot_bounds:
        x0, x1 = dot_bounds
        y0 = max(0, line.top - 4)
        width = max(48, x1 - x0 + 18)
        height = max(20, line.bottom - line.top + 10)
    elif kind == "choice":
        x0 = min(page_width - 92, max(line.x1 + 8, page_width * 0.72))
        y0 = max(0, line.top - 3)
        width = 82
        height = max(22, line.bottom - line.top + 8)
    else:
        x0 = min(page_width - 130, max(line.x1 + 8, page_width * 0.62))
        y0 = max(0, line.top - 4)
        width = 118
        height = max(22, line.bottom - line.top + 9)

    return {
        "pageKey": page["pageKey"],
        "pdfPage": page["pdfPage"],
        "x": round(x0 / page_width, 5),
        "y": round(y0 / page_height, 5),
        "width": round(min(width, page_width - x0) / page_width, 5),
        "height": round(min(height, page_height - y0) / page_height, 5),
        "inputKind": kind,
        "source": "pdf-text-layer",
        "fallbackIndex": fallback_index,
    }


def fallback_hotspot(page: dict[str, Any], question: dict[str, Any], kind: str, fallback_index: int) -> dict[str, Any]:
    question_number = int(question["questionNumber"])
    section_start = ((question_number - 1) // 10) * 10 + 1
    offset = question_number - section_start
    x = 0.70 if kind == "choice" else 0.58
    y = 0.18 + (offset * 0.062)
    return {
        "pageKey": page["pageKey"],
        "pdfPage": page["pdfPage"],
        "x": round(x, 5),
        "y": round(min(y, 0.88), 5),
        "width": 0.17 if kind == "choice" else 0.25,
        "height": 0.034,
        "inputKind": kind,
        "source": "fallback-grid",
        "fallbackIndex": fallback_index,
    }


def best_hotspot(pages: list[dict[str, Any]], question: dict[str, Any], question_type: str, fallback_index: int) -> dict[str, Any]:
    kind = input_kind(question_type, question.get("answers", []))
    question_number = int(question["questionNumber"])
    best: tuple[int, Line, dict[str, Any]] | None = None

    for page in pages:
        for line in page["lines"]:
            score = score_line(line, question_number, float(page["height"]), kind)
            if score <= -100:
                continue
            if best is None or score > best[0]:
                best = (score, line, page)

    if best is not None and best[0] >= 0:
        return make_hotspot(best[1], best[2], question, kind, fallback_index)

    page = pages[min(fallback_index, len(pages) - 1)]
    return fallback_hotspot(page, question, kind, fallback_index)


def collect_raw_pages_from_page_stream(book_number: int, page_stream: list[dict[str, Any]]) -> list[dict[str, Any]]:
    raw_pages: list[dict[str, Any]] = []
    current_test: int | None = None
    in_listening = False

    for page in page_stream:
        lines = page["lines"]
        text = normalize_text_markers(page["text"])
        if re.search(r"\bAnswer Key\b|Each question correctly answered|SAMPLE ANSWER", text, re.I):
            current_test = None
            in_listening = False
            continue
        test_match = re.search(r"\bTest\s+([1-4])\b", text, re.I)
        if test_match:
            next_test = int(test_match.group(1))
            has_listening_marker = re.search(r"LISTE|Section\s+1", text, re.I) is not None
            in_listening = has_listening_marker or (current_test == next_test and in_listening)
            current_test = next_test
        elif current_test and re.search(r"LISTE", text, re.I):
            in_listening = True

        has_reading_marker = bool(re.search(r"\bREADING PASSAGE\b|(?:^|\n)\s*R\s*E\s*A\s*DING\b|(?:^|\n)\s*READING\b", text, re.I))

        if not current_test or not in_listening:
            continue

        page_sections: set[int] = set()
        for start, end in extract_ranges(text):
            if 1 <= start <= 40:
                page_sections.add(question_section(start))
            if 1 <= end <= 40:
                page_sections.add(question_section(end))

        if not page_sections:
            for question_number in extract_line_question_numbers(lines):
                page_sections.add(question_section(question_number))

        if not page_sections:
            if current_test and in_listening and has_reading_marker:
                in_listening = False
            continue

        raw_pages.append({
            "testNumber": current_test,
            "sectionNumbers": sorted(page_sections),
            "pdfPage": page["pdfPage"],
            "pageKey": page["pageKey"],
            "width": page["width"],
            "height": page["height"],
            "storagePath": "",
            "lines": lines,
        })

        if has_reading_marker:
            in_listening = False

    return raw_pages


def extract_overlay(pdf_path: str, candidate_path: str, ocr_json_path: str | None = None) -> dict[str, Any]:
    with open(candidate_path, "r", encoding="utf-8") as file:
        book = json.load(file)

    book_number = int(book["bookNumber"])
    page_stream: list[dict[str, Any]] = []

    with pdfplumber.open(pdf_path) as pdf:
        for index, pdf_page in enumerate(pdf.pages, start=1):
            words = pdf_page.extract_words(x_tolerance=3, y_tolerance=3, keep_blank_chars=False) or []
            lines = group_lines(words)
            page_stream.append({
                "pdfPage": index,
                "pageKey": page_key(index),
                "width": float(pdf_page.width),
                "height": float(pdf_page.height),
                "lines": lines,
                "text": "\n".join(line.text for line in lines),
            })

    raw_pages = collect_raw_pages_from_page_stream(book_number, page_stream)
    if len(raw_pages) < 16:
        ocr_raw_pages = collect_raw_pages_from_page_stream(book_number, load_ocr_pages(ocr_json_path))
        if len(ocr_raw_pages) > len(raw_pages):
            raw_pages = ocr_raw_pages

    pages_by_section: dict[str, list[dict[str, Any]]] = {}
    for page in raw_pages:
        for section_number in page["sectionNumbers"]:
            key = f"{page['testNumber']}:{section_number}"
            page_copy = {
                "pageKey": page["pageKey"],
                "pdfPage": page["pdfPage"],
                "width": page["width"],
                "height": page["height"],
                "storagePath": storage_path(book_number, int(page["testNumber"]), int(section_number), int(page["pdfPage"])),
                "sortOrder": len(pages_by_section.get(key, [])),
                "lines": page["lines"],
            }
            pages_by_section.setdefault(key, []).append(page_copy)

    public_pages_by_section: dict[str, list[dict[str, Any]]] = {}
    hotspots: dict[str, dict[str, Any]] = {}
    missing_sections: list[str] = []

    for test in book["tests"]:
        test_number = int(test["testNumber"])
        for section in test["sections"]:
            section_number = int(section["sectionNumber"])
            section_key = f"{test_number}:{section_number}"
            pages = pages_by_section.get(section_key, [])
            if not pages:
                missing_sections.append(section_key)
                continue

            public_pages_by_section[section_key] = [
                {
                    "pageKey": page["pageKey"],
                    "pdfPage": page["pdfPage"],
                    "width": page["width"],
                    "height": page["height"],
                    "storagePath": page["storagePath"],
                    "imageUrl": "",
                    "sortOrder": page["sortOrder"],
                }
                for page in pages
            ]

            fallback_index = 0
            for group in section["groups"]:
                for question in group["questions"]:
                    question_key = f"{test_number}:{question['questionNumber']}"
                    hotspots[question_key] = best_hotspot(pages, question, group["type"], fallback_index)
                    fallback_index += 1

    return {
        "paperPagesBySection": public_pages_by_section,
        "hotspots": hotspots,
        "missingSections": missing_sections,
        "summary": {
            "paperPageCount": sum(len(pages) for pages in public_pages_by_section.values()),
            "uniquePdfPageCount": len({page["pdfPage"] for pages in public_pages_by_section.values() for page in pages}),
            "hotspotCount": len(hotspots),
            "fallbackHotspotCount": sum(1 for hotspot in hotspots.values() if hotspot.get("source") == "fallback-grid"),
        },
    }


def main() -> None:
    if len(sys.argv) not in (3, 4):
        print("Usage: extract-ielts-listening-paper.py <pdf_path> <candidate_json> [ocr_json]", file=sys.stderr)
        sys.exit(1)

    result = extract_overlay(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) == 4 else None)
    sys.stdout.write(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
