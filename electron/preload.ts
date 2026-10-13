import { contextBridge, ipcRenderer } from 'electron'
import type { FabricatorDesktopApi } from '../src/shared/fabricator'

const fabricatorApi: FabricatorDesktopApi = {
  listFabricatorSlots: () => ipcRenderer.invoke('fabricator:list-slots'),
  importFabricatorModel: (slot) => ipcRenderer.invoke('fabricator:import-model', slot),
  loadFabricatorSlot: (slot) => ipcRenderer.invoke('fabricator:load-slot', slot),
  saveFabricatorProject: (project) => ipcRenderer.invoke('fabricator:save-project', project)
}

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  appName: 'Gacha Nymi',
  ...fabricatorApi
})
