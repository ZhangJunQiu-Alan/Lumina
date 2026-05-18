#!/usr/bin/env swift
import AppKit
import Foundation
import PDFKit
import Vision

struct OcrLine: Codable {
  let text: String
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

struct OcrPage: Codable {
  let pageNumber: Int
  let width: Double
  let height: Double
  let text: String
  let lines: [OcrLine]
}

struct OcrDocument: Codable {
  let source: String
  let pages: [OcrPage]
  let text: String
}

func argumentValue(_ name: String) -> String? {
  let arguments = CommandLine.arguments
  guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else {
    return nil
  }
  return arguments[index + 1]
}

guard let pdfPath = argumentValue("--pdf") else {
  fputs("Usage: swift scripts/extract-pdf-vision-ocr.swift --pdf <file> [--out <json>]\n", stderr)
  exit(1)
}

let pdfURL = URL(fileURLWithPath: pdfPath)
guard let document = PDFDocument(url: pdfURL) else {
  fputs("Unable to open PDF: \(pdfPath)\n", stderr)
  exit(1)
}

func renderPage(_ page: PDFPage, scale: CGFloat = 2.0) -> CGImage? {
  let bounds = page.bounds(for: .mediaBox)
  let pixelWidth = Int(bounds.width * scale)
  let pixelHeight = Int(bounds.height * scale)
  guard pixelWidth > 0, pixelHeight > 0 else { return nil }

  let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: pixelWidth,
    pixelsHigh: pixelHeight,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
  )
  guard let bitmap else { return nil }

  NSGraphicsContext.saveGraphicsState()
  guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
    NSGraphicsContext.restoreGraphicsState()
    return nil
  }
  NSGraphicsContext.current = context
  NSColor.white.setFill()
  NSRect(x: 0, y: 0, width: CGFloat(pixelWidth), height: CGFloat(pixelHeight)).fill()
  context.cgContext.scaleBy(x: scale, y: scale)
  page.draw(with: .mediaBox, to: context.cgContext)
  NSGraphicsContext.restoreGraphicsState()

  return bitmap.cgImage
}

func recognizeLines(from image: CGImage) throws -> [OcrLine] {
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = true
  request.recognitionLanguages = ["en-US"]

  let handler = VNImageRequestHandler(cgImage: image, options: [:])
  try handler.perform([request])

  return (request.results ?? []).compactMap { observation in
    guard let candidate = observation.topCandidates(1).first else { return nil }
    let box = observation.boundingBox
    return OcrLine(
      text: candidate.string,
      x: Double(box.minX),
      y: Double(1.0 - box.maxY),
      width: Double(box.width),
      height: Double(box.height)
    )
  }
}

var pages: [OcrPage] = []
for index in 0..<document.pageCount {
  guard let page = document.page(at: index), let image = renderPage(page) else {
    continue
  }
  let lines = try recognizeLines(from: image)
  let bounds = page.bounds(for: .mediaBox)
  let pageText = lines.map(\.text).joined(separator: "\n")
  pages.append(OcrPage(
    pageNumber: index + 1,
    width: Double(bounds.width),
    height: Double(bounds.height),
    text: pageText,
    lines: lines
  ))
  fputs("OCR page \(index + 1)/\(document.pageCount): \(lines.count) lines\n", stderr)
}

let output = OcrDocument(
  source: pdfURL.lastPathComponent,
  pages: pages,
  text: pages.map { "\n\n\u{000C}Page \($0.pageNumber)\n\($0.text)" }.joined(separator: "\n")
)

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
let data = try encoder.encode(output)

if let outPath = argumentValue("--out") {
  let outURL = URL(fileURLWithPath: outPath)
  try FileManager.default.createDirectory(
    at: outURL.deletingLastPathComponent(),
    withIntermediateDirectories: true
  )
  try data.write(to: outURL)
} else {
  FileHandle.standardOutput.write(data)
}
