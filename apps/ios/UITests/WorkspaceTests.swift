import XCTest

final class WorkspaceTests:XCTestCase {
    func testConnectedWorkspace() throws {
        continueAfterFailure = false
        let env=ProcessInfo.processInfo.environment
        let address=try XCTUnwrap(env["BATON_TEST_ADDRESS"])
        let app=XCUIApplication()
        let system=XCUIApplication(bundleIdentifier:"com.apple.springboard")
        func dismissStaleDeveloperAlerts() {
            // iOS may retain an earlier launch warning after the user has trusted the app.
            let deadline = Date().addingTimeInterval(120)
            while Date() < deadline {
                let alert = system.alerts.firstMatch
                guard alert.exists,
                      ["不受信任的开发者", "未受信任的開發者", "Untrusted Developer"].contains(alert.label),
                      alert.buttons.count == 1 else { return }
                let cancel = alert.buttons.firstMatch
                guard ["取消", "Cancel"].contains(cancel.label) else { return }
                cancel.tap()
            }
        }
        func handleNetworkPrompt() {
            let prompt=system.alerts.firstMatch
            guard prompt.exists else { return }
            let label=prompt.label+" "+prompt.staticTexts.allElementsBoundByIndex.map(\.label).joined(separator:" ")
            let actions = prompt.buttons.allElementsBoundByIndex.map(\.label)
            let local = label.localizedCaseInsensitiveContains("local network") ||
                ["本地网络", "本機網絡", "區域網路", "局域网"].contains(where: label.contains)
            let wireless = label.contains("Baton") &&
                ["使用无线数据", "使用行動數據", "use wireless data"].contains(where: label.localizedCaseInsensitiveContains)
            let choices = wireless ? ["仅无线局域网", "仅 WLAN", "WLAN Only", "Wi-Fi Only"] :
                local ? ["允许", "允許", "Allow", "OK", "好"] : []
            for title in choices where actions.contains(title) {
                prompt.buttons[title].tap()
                return
            }
            print("System dialog during Baton connection: " + prompt.label.prefix(180) + ", actions: " + actions.joined(separator: ", "))
        }
        dismissStaleDeveloperAlerts()
        handleNetworkPrompt()
        app.launch()
        if address.hasPrefix("baton://") {
            // Exercise the same URL entry point as opening a pairing link on iPhone.
            app.open(try XCTUnwrap(URL(string: address)))
            for _ in 0..<2 {
                guard system.alerts.firstMatch.waitForExistence(timeout: 3) else { break }
                dismissStaleDeveloperAlerts()
                handleNetworkPrompt()
            }
            if app.buttons["重新连接"].exists { app.buttons["重新连接"].tap() }
        } else {
            if app.buttons["工作空间"].exists { app.buttons["工作空间"].firstMatch.tap() }
            let field = app.textFields.firstMatch
            XCTAssertTrue(field.waitForExistence(timeout: 10))
            field.tap()
            field.typeText(address)
            app.buttons["连接"].tap()
        }
        let web=app.webViews.firstMatch
        if let password=env["BATON_TEST_PASSWORD"], !web.buttons["任务"].waitForExistence(timeout:3) {
            let name=web.textFields.firstMatch
            XCTAssertTrue(name.waitForExistence(timeout:20));name.tap();name.typeText("Kai")
            let pwd=web.secureTextFields.firstMatch;pwd.tap();pwd.typeText(password)
            web.buttons["登录"].tap()
        }
        XCTAssertTrue(web.buttons["任务"].waitForExistence(timeout:20))
        if let expected=env["BATON_TEST_ACCEPT_TITLE"] {
            web.buttons["待我处理"].tap()
            let pending=web.buttons.containing(NSPredicate(format:"label BEGINSWITH %@",expected)).firstMatch
            XCTAssertTrue(pending.waitForExistence(timeout:12))
            pending.tap()
            web.buttons["确认验收"].tap()
            web.buttons["确认"].tap()
            XCTAssertTrue(web.staticTexts["已完成"].waitForExistence(timeout:12))
        }
        web.buttons["任务"].tap()
        web.buttons["创建任务"].tap()
        let title=web.textFields.firstMatch
        XCTAssertTrue(title.waitForExistence(timeout:8))
        title.tap();title.typeText("iOS QA")
        let target=web.textViews.firstMatch
        target.tap();target.typeText("Verify the task on another client")
        web.buttons["创建"].tap()
        XCTAssertTrue(web.buttons["启动任务"].waitForExistence(timeout:12))
    }
}
