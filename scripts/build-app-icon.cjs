// Keep the owner-supplied master untouched; build purpose-specific app assets.
// CoreGraphics clips the tile edge and gives macOS its own transparent inset.
const { mkdtemp, mkdir, readFile, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { execFileSync } = require('node:child_process');

  async function build() {
    if (process.platform !== 'darwin') throw new Error('Icon generation requires macOS iconutil; generated assets are committed.');
    const scratch = await mkdtemp(join(tmpdir(), 'baton-icon-'));
    try {
      const png = resolve('web/icons/application.png');
      const source = await readFile(png);
      if (source.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || source.readUInt32BE(16) !== source.readUInt32BE(20) || source.readUInt32BE(16) < 1024) throw new Error('Application icon must be a square PNG of at least 1024px.');
      const renderer = join(scratch, 'render.swift');
      await writeFile(renderer, `
import AppKit
import ImageIO
import UniformTypeIdentifiers
let sourceURL = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2])
guard let input = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
      let master = CGImageSourceCreateImageAtIndex(input, 0, nil) else { fatalError("Cannot decode application master") }
// The supplied 1254px master includes outer white presentation margins.
// Crop those margins only; the owner master is copied verbatim and never edited.
let image = master.cropping(to: CGRect(x: 132, y: 132, width: 984, height: 984))!
func render(_ name: String, _ size: Int, _ paint: (CGContext) -> Void) {
    let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size * 4,
        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.interpolationQuality = .high
    paint(context)
    let destination = CGImageDestinationCreateWithURL(output.appendingPathComponent(name) as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, context.makeImage()!, nil)
    guard CGImageDestinationFinalize(destination) else { fatalError("Cannot encode icon") }
}
func tile(_ context: CGContext, _ rect: CGRect) {
    context.saveGState()
    context.addPath(CGPath(roundedRect: rect, cornerWidth: rect.width * 0.205, cornerHeight: rect.height * 0.205, transform: nil))
    context.clip()
    // Keep the complete supplied composition inside the standard rounded tile.
    // The matte only fills any transparency in the owner-supplied source.
    context.setFillColor(CGColor(srgbRed: 0.02, green: 0.04, blue: 0.16, alpha: 1))
    context.fill(rect)
    context.draw(image, in: rect)
    context.restoreGState()
}
render("application-ui.png", 1024) { tile($0, CGRect(x: 0, y: 0, width: 1024, height: 1024)) }
render("application-dock.png", 1024) { tile($0, CGRect(x: 100, y: 100, width: 824, height: 824)) }
// Derive the monochrome B from the actual coloured mark, including its play
// counter. White tile/shadow pixels are excluded, then alpha alone is templated.
let mark = master.cropping(to: CGRect(x: 304, y: 304, width: 644, height: 652))!
let maskContext = CGContext(data: nil, width: mark.width, height: mark.height, bitsPerComponent: 8,
    bytesPerRow: mark.width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
maskContext.draw(mark, in: CGRect(x: 0, y: 0, width: mark.width, height: mark.height))
let pixels = maskContext.data!.bindMemory(to: UInt8.self, capacity: mark.width * mark.height * 4)
for i in 0..<(mark.width * mark.height) {
    let offset = i * 4
    let r = Int(pixels[offset]), g = Int(pixels[offset + 1]), b = Int(pixels[offset + 2])
    let blueMark = b > 100 && r < 170 && b - r > 45 && max(r, max(g, b)) - min(r, min(g, b)) > 70
    pixels[offset] = 0; pixels[offset + 1] = 0; pixels[offset + 2] = 0; pixels[offset + 3] = blueMark ? 255 : 0
}
let template = maskContext.makeImage()!
for scale in [1, 2] {
    render(scale == 1 ? "trayTemplate.png" : "trayTemplate@2x.png", 18 * scale) { c in
        c.draw(template, in: CGRect(x: CGFloat(scale) * 1.5, y: CGFloat(scale) * 1.5,
            width: CGFloat(scale) * 15, height: CGFloat(scale) * 15))
    }
}

`);
      execFileSync('/usr/bin/swift', [renderer, png, resolve('web/icons')], { stdio: 'inherit' });
      const iconset = join(scratch, 'application.iconset'); await mkdir(iconset);
      for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) {
        execFileSync('/usr/bin/sips', ['-z', String(size * scale), String(size * scale), resolve('web/icons/application-dock.png'), '--out', join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)], { stdio: 'ignore' });
      }
      execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', resolve('apps/electron/application.icns')]);
      console.log('Generated clean UI tile, inset Dock/ICNS and 1x/2x menu-bar templates; application.png unchanged');
    } finally { await rm(scratch, { recursive: true, force: true }); }
  }
  build().catch(error => { console.error(error); process.exitCode = 1; });
