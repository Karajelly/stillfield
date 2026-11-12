import UIKit

/// A meadow postcard: a still picture of the farm exactly as it stands, on a
/// cream card with a line about what is growing. It is drawn on this device and
/// goes nowhere unless the player saves or shares it.
struct Postcard {
    let card: UIImage
    /// The same card as a PNG in the temporary directory, for the share sheet.
    let file: URL
}

@MainActor
enum PostcardMaker {
    /// Photograph the app's window as it is on screen. The caller hides the
    /// controls first, so the picture is the meadow alone. Returns nil when the
    /// window cannot be read or comes back as a single flat colour, which is
    /// what an uncaptured 3D view looks like.
    static func photograph() -> UIImage? {
        guard let window = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .flatMap(\.windows)
            .first(where: \.isKeyWindow) else { return nil }
        let photo = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        return looksBlank(photo) ? nil : photo
    }

    /// Lay the photograph on its card with a two-line caption and the wordmark.
    static func make(photo: UIImage, title: String, line: String) -> Postcard? {
        // Sizes follow the photograph, so a phone and an iPad card share one layout.
        let unit = photo.size.width / 100
        let margin = unit * 4.5
        let size = CGSize(width: photo.size.width + margin * 2, height: photo.size.height + margin + unit * 17)
        let format = UIGraphicsImageRendererFormat()
        format.scale = photo.scale
        format.opaque = true
        let ink = UIColor(farmHex: "#344C40")
        let card = UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor(farmHex: "#F7F5E9").setFill()
            context.fill(CGRect(origin: .zero, size: size))
            let frame = CGRect(x: margin, y: margin, width: photo.size.width, height: photo.size.height)
            let edge = UIBezierPath(roundedRect: frame, cornerRadius: unit)
            context.cgContext.saveGState()
            edge.addClip()
            photo.draw(in: frame)
            context.cgContext.restoreGState()
            ink.withAlphaComponent(0.12).setStroke()
            edge.lineWidth = 1
            edge.stroke()

            (title as NSString).draw(
                at: CGPoint(x: margin, y: frame.maxY + unit * 3.2),
                withAttributes: [.font: serif(size: unit * 4.6, italic: true), .foregroundColor: ink])
            (line as NSString).draw(
                at: CGPoint(x: margin, y: frame.maxY + unit * 9.6),
                withAttributes: [.font: UIFont.systemFont(ofSize: unit * 2.3),
                                 .foregroundColor: UIColor(farmHex: "#7D8874")])
            let mark = NSAttributedString(string: "stillfield", attributes: [
                .font: serif(size: unit * 5.4, italic: false, weight: .medium),
                .foregroundColor: ink, .kern: -unit * 0.2,
            ])
            mark.draw(at: CGPoint(x: size.width - margin - mark.size().width, y: frame.maxY + unit * 4.4))
        }
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("stillfield-postcard.png")
        guard let data = card.pngData(), (try? data.write(to: file, options: .atomic)) != nil else { return nil }
        return Postcard(card: card, file: file)
    }

    private static func serif(size: CGFloat, italic: Bool, weight: UIFont.Weight = .regular) -> UIFont {
        var descriptor = UIFont.systemFont(ofSize: size, weight: weight).fontDescriptor
        if let designed = descriptor.withDesign(.serif) { descriptor = designed }
        if italic, let slanted = descriptor.withSymbolicTraits(.traitItalic) { descriptor = slanted }
        return UIFont(descriptor: descriptor, size: size)
    }

    /// True when a coarse sample of the picture is one colour throughout.
    private static func looksBlank(_ image: UIImage) -> Bool {
        let side = 12
        guard let source = image.cgImage,
              let sample = CGContext(data: nil, width: side, height: side, bitsPerComponent: 8,
                                     bytesPerRow: side * 4, space: CGColorSpaceCreateDeviceRGB(),
                                     bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return true }
        sample.draw(source, in: CGRect(x: 0, y: 0, width: side, height: side))
        guard let bytes = sample.data?.assumingMemoryBound(to: UInt8.self) else { return true }
        var lowest: [UInt8] = [255, 255, 255], highest: [UInt8] = [0, 0, 0]
        for pixel in 0..<side * side {
            for channel in 0..<3 {
                let value = bytes[pixel * 4 + channel]
                lowest[channel] = min(lowest[channel], value)
                highest[channel] = max(highest[channel], value)
            }
        }
        return (0..<3).allSatisfy { highest[$0] - lowest[$0] < 12 }
    }
}
