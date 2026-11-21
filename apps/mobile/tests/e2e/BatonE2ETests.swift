import XCTest

/// Step-driven UI test for the installed Baton app (bundle com.dengdai68.baton.mobile).
///
/// Environment (pass with the TEST_RUNNER_ prefix to xcodebuild):
///   BATON_E2E_STEPS  path to a JSON array of steps (see tests/e2e/README in apps/mobile/README.md)
///   BATON_E2E_OUT    directory for screenshots and element dumps
/// Without BATON_E2E_STEPS the test is skipped, so build-for-testing never needs data.
final class BatonE2ETests: XCTestCase {
  struct Step: Decodable {
    let action: String
    let value: String?
    let into: String?
    let timeout: Double?
    let x: Double?
    let y: Double?
    let index: Int?
    let optional: Bool?
  }

  let app = XCUIApplication(bundleIdentifier: "com.dengdai68.baton.mobile")
  let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")

  func testSteps() throws {
    let environment = ProcessInfo.processInfo.environment
    guard let stepsPath = environment["BATON_E2E_STEPS"] else { throw XCTSkip("BATON_E2E_STEPS not set") }
    let out = URL(fileURLWithPath: environment["BATON_E2E_OUT"] ?? NSTemporaryDirectory(), isDirectory: true)
    try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
    let steps = try JSONDecoder().decode([Step].self, from: Data(contentsOf: URL(fileURLWithPath: stepsPath)))
    continueAfterFailure = false
    for (index, step) in steps.enumerated() {
      print("E2E step \(index + 1)/\(steps.count): \(step.action) \(step.value ?? "") \(step.into ?? "")")
      do {
        try run(step, out: out)
      } catch {
        if step.optional == true { print("E2E optional step skipped: \(error)"); continue }
        save(name: String(format: "failure-%02d", index + 1), out: out)
        try? app.debugDescription.write(to: out.appendingPathComponent("failure-tree.txt"), atomically: true, encoding: .utf8)
        throw error
      }
    }
  }

  struct StepError: Error, CustomStringConvertible { let description: String }

  /// Match by accessibility label/identifier; "^text" = prefix, "~text" = contains.
  func element(_ query: String, index: Int = 0) -> XCUIElement {
    let element = app.descendants(matching: .any).matching(predicate(of: query)).element(boundBy: index)
    return element
  }

  func predicate(of query: String) -> NSPredicate {
    // Comma-separated alternatives ("a|b|c" also allowed); "^" prefix / "~" contains.
    let alternatives = query.contains("|") ? query.components(separatedBy: "|") : query.components(separatedBy: ",")
    let subs = alternatives.map { raw -> NSPredicate in
      let value = raw.trimmingCharacters(in: .whitespaces)
      if value.hasPrefix("^") {
        let text = String(value.dropFirst())
        return NSPredicate(format: "label BEGINSWITH %@ OR identifier BEGINSWITH %@", text, text)
      }
      if value.hasPrefix("~") {
        let text = String(value.dropFirst())
        return NSPredicate(format: "label CONTAINS %@ OR identifier CONTAINS %@", text, text)
      }
      return NSPredicate(format: "label == %@ OR identifier == %@ OR label BEGINSWITH %@ OR identifier BEGINSWITH %@", value, value, value, value)
    }
    return NSCompoundPredicate(orPredicateWithSubpredicates: subs)
  }

  func dismissSystemAlert(preferring titles: [String]) -> Bool {
    let alert = springboard.alerts.firstMatch
    guard alert.waitForExistence(timeout: 2) else { return false }
    for title in titles where alert.buttons[title].exists {
      alert.buttons[title].tap()
      return true
    }
    return false
  }

  func save(name: String, out: URL) {
    let png = XCUIScreen.main.screenshot().pngRepresentation
    try? png.write(to: out.appendingPathComponent(name + ".png"))
    let attachment = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  func run(_ step: Step, out: URL) throws {
    let timeout = step.timeout ?? 10
    switch step.action {
    case "launch":
      app.launch()
    case "activate":
      app.activate()
    case "terminate":
      app.terminate()
    case "open":
      guard let link = step.value, let url = URL(string: link) else { throw StepError(description: "open needs a URL") }
      app.open(url)
      _ = dismissSystemAlert(preferring: ["打开", "Open", "打開"])
    case "alert":
      if !dismissSystemAlert(preferring: (step.value ?? "允许").components(separatedBy: "|")) && step.optional != true {
        throw StepError(description: "no system alert with \(step.value ?? "")")
      }
    case "tap":
      // Prefer buttons/links; fall back to any element (list rows are plain views).
      let label = step.value ?? ""
      // Rows are accessibility elements whose label joins title and subtitle;
      // the exact text varies, so locate them first.
      let buttons = app.buttons.containing(predicate(of: label))
      let buttonCount = buttons.count
      if buttonCount > 0 { buttons.element(boundBy: step.index ?? 0).tap(); return }
      let rows = app.otherElements.containing(predicate(of: label))
      let rowCount = rows.count
      if rowCount > 0 { rows.element(boundBy: step.index ?? 0).tap(); return }
      let any = element(label, index: step.index ?? 0)
      guard any.waitForExistence(timeout: timeout) else { throw StepError(description: "not found: \(label)") }
      any.tap()
    case "tab":
      let target = app.tabBars.buttons[step.value ?? ""]
      guard target.waitForExistence(timeout: timeout) else { throw StepError(description: "tab not found: \(step.value ?? "")") }
      target.tap()
    case "back":
      let back = app.navigationBars.buttons.element(boundBy: 0)
      guard back.waitForExistence(timeout: timeout) else { throw StepError(description: "no back button") }
      back.tap()
    case "set":
      // Set text via the pasteboard: reliable for controlled multiline inputs.
      let intoField = step.into ?? ""
      let textViews = app.textViews.containing(predicate(of: intoField))
      let targetField: XCUIElement
      if textViews.count > 0 { targetField = textViews.element(boundBy: step.index ?? 0) } else {
        let anyField = element(intoField, index: step.index ?? 0)
        guard anyField.waitForExistence(timeout: timeout) else { throw StepError(description: "field not found: \(intoField)") }
        targetField = anyField
      }
      UIPasteboard.general.string = step.value ?? ""
      targetField.tap()
      sleep(1)
      if !app.menuItems["Paste"].waitForExistence(timeout: 3) { targetField.doubleTap(); _ = app.menuItems["Paste"].waitForExistence(timeout: 3) }
      guard app.menuItems["Paste"].exists else { throw StepError(description: "no paste menu") }
      app.menuItems["Paste"].tap()
      sleep(1)
    case "type":
      let into = step.into ?? ""
      let textViews = app.textViews.containing(predicate(of: into))
      let textViewCount = textViews.count
      let target: XCUIElement
      if textViewCount > 0 { target = textViews.element(boundBy: step.index ?? 0) } else {
        let any = element(into, index: step.index ?? 0)
        guard any.waitForExistence(timeout: timeout) else { throw StepError(description: "field not found: \(into)") }
        target = any
      }
      target.tap()
      target.typeText(step.value ?? "")
    case "wait":
      guard element(step.value ?? "", index: step.index ?? 0).waitForExistence(timeout: timeout) else {
        throw StepError(description: "timed out waiting for \(step.value ?? "")")
      }
    case "gone":
      let target = element(step.value ?? "", index: step.index ?? 0)
      let deadline = Date().addingTimeInterval(timeout)
      while target.exists && Date() < deadline { Thread.sleep(forTimeInterval: 0.3) }
      if target.exists { throw StepError(description: "still visible: \(step.value ?? "")") }
    case "shot":
      save(name: step.value ?? "screen", out: out)
    case "dump":
      try app.debugDescription.write(to: out.appendingPathComponent((step.value ?? "tree") + ".txt"), atomically: true, encoding: .utf8)
    case "swipe":
      switch step.value {
      case "down": app.swipeDown()
      case "left": app.swipeLeft()
      case "right": app.swipeRight()
      default: app.swipeUp()
      }
    case "tapPoint":
      app.coordinate(withNormalizedOffset: CGVector(dx: step.x ?? 0.5, dy: step.y ?? 0.5)).tap()
    case "longPress":
      let target = element(step.value ?? "", index: step.index ?? 0)
      guard target.waitForExistence(timeout: timeout) else { throw StepError(description: "not found: \(step.value ?? "")") }
      target.press(forDuration: 1.0)
    case "sheet":
      // Action sheets and alerts presented by the app itself.
      let button = app.sheets.buttons[step.value ?? ""].exists ? app.sheets.buttons[step.value ?? ""] : app.alerts.buttons[step.value ?? ""]
      guard button.waitForExistence(timeout: timeout) else { throw StepError(description: "sheet button not found: \(step.value ?? "")") }
      button.tap()
    case "sleep":
      Thread.sleep(forTimeInterval: Double(step.value ?? "1") ?? 1)
    default:
      throw StepError(description: "unknown action \(step.action)")
    }
  }
}
