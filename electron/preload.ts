import { contextBridge, ipcRenderer } from 'electron'
import type { FabricatorDesktopApi } from '../src/shared/fabricator'

const fabricatorApi: FabricatorDesktopApi = {
  listFabricatorSlots: () => ipcRenderer.invoke('fabricator:list-slots'),
  importFabricatorModel: (slot) => ipcRenderer.invoke('fabricator:import-model', slot),
  loadFabricatorSlot: (slot) => ipcRenderer.invoke('fabricator:load-slot', slot),
  saveFabricatorProject: (project, changedAssets) => ipcRenderer.invoke('fabricator:save-project', project, changedAssets),
  deleteFabricatorSlot: (slot) => ipcRenderer.invoke('fabricator:delete-slot', slot)
}

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  appName: 'Gacha Nymi',
  ...fabricatorApi
})
