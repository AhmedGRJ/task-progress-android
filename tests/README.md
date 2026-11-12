# Tests

    node tests/sync-test.js     merge engine + relay + encryption + file/WebDAV transport (no dependencies)
    node tests/hub-test.js      the Windows app's embedded hub and shared-file handlers (stubs Electron)
    node tests/e2e.js           two real browsers syncing through a relay (needs: npm i playwright, a relay on :8083
                                and the web app on :8082, see the comments at the top of the file)
    node tests/desk-ui.js       the hub / shared-file parts of the Sync dialog with a mocked desktop bridge (needs playwright, web app on :8082)
