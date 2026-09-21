const { app, BrowserWindow } = require("electron");
app.setPath("userData", process.env.CL_TEST_HOME);
app.whenReady().then(() => {
  const win = new BrowserWindow({
    show: false,
    width: 850,
    height: 650,
    webPreferences: { backgroundThrottling: false },
  });
  win.loadFile(require("node:path").join(__dirname, "../dist/fixture.html"));
});
app.on("window-all-closed", () => app.quit());
