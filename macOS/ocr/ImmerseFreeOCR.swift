import AppKit
import Foundation
import Vision

struct OCRLine: Codable {
    let text: String
    let confidence: Float
    let left: Double
    let top: Double
    let width: Double
    let height: Double
}

func fail(_ message: String, code: Int32 = 1) -> Never {
    fputs(message + "\n", stderr)
    exit(code)
}

guard CommandLine.arguments.count > 1,
      let image = NSImage(contentsOfFile: CommandLine.arguments[1]) else {
    fail("無法開啟 OCR 圖片")
}

var proposedRect = NSRect(origin: .zero, size: image.size)
guard let cgImage = image.cgImage(forProposedRect: &proposedRect, context: nil, hints: nil) else {
    fail("無法建立 OCR 圖片緩衝區")
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = ["en-US", "zh-Hant"]
request.customWords = [
    "AI", "ASIC", "GPU", "CPU", "HPC", "OSAT", "CPO", "TPU", "IC", "EPS",
    "EBITDA", "CAGR", "Hon Precision", "Nvidia", "Taiwan", "NT$"
]
request.minimumTextHeight = 0.004

do {
    try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
} catch {
    let value = error as NSError
    fail("OCR 失敗：\(value.localizedDescription)", code: 2)
}

let lines = (request.results ?? []).compactMap { observation -> OCRLine? in
    guard let candidate = observation.topCandidates(1).first else { return nil }
    let box = observation.boundingBox
    return OCRLine(
        text: candidate.string,
        confidence: candidate.confidence,
        left: box.origin.x,
        top: 1 - box.origin.y - box.size.height,
        width: box.size.width,
        height: box.size.height
    )
}.sorted {
    if abs($0.top - $1.top) > 0.006 { return $0.top < $1.top }
    return $0.left < $1.left
}

do {
    let encoder = JSONEncoder()
    print(String(data: try encoder.encode(lines), encoding: .utf8) ?? "[]")
} catch {
    fail("無法輸出 OCR 結果", code: 3)
}
