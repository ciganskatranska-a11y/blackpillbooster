const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("updater", {
	start: () => ipcRenderer.invoke("update:start"),
	later: () => ipcRenderer.invoke("update:later"),
	onState: callback => {
		ipcRenderer.on("update:state", (_event, state) => callback(state));
		ipcRenderer.send("update:ready");
	},
});
