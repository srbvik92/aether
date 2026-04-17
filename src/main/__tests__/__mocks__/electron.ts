// Stub Electron modules for unit tests
export const app = {
  getPath: (name: string) => {
    const os = require('os')
    const path = require('path')
    if (name === 'userData') return path.join(os.tmpdir(), 'chatui-test-userdata')
    return os.tmpdir()
  },
  getName: () => 'test-app'
}

export const ipcMain = {
  handle: () => {},
  on:     () => {},
  removeHandler: () => {}
}

export const dialog = {
  showOpenDialog: async () => ({ canceled: true, filePaths: [] })
}

export default { app, ipcMain, dialog }
