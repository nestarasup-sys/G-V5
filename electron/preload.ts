import { contextBridge, ipcRenderer } from 'electron'
import type { FabricatorDesktopApi } from '../src/shared/fabricator'

const fabricatorApi: FabricatorDesktopApi = {
  listFabricatorSlots: () => ipcRenderer.invoke('fabricator:list-slots'),
  importFabricatorModel: (slot) => ipcRenderer.invoke('fabricator:import-model', slot),
  loadFabricatorSlot: (slot) => ipcRenderer.invoke('fabricator:load-slot', slot),
  saveFabricatorProject: (project, changedAssets) => ipcRenderer.invoke('fabricator:save-project', project, changedAssets),
  loadFabricatorHistory: (slot) => ipcRenderer.invoke('fabricator:load-history', slot),
  saveFabricatorHistory: (slot, history, current, changedAssets) => ipcRenderer.invoke('fabricator:save-history', slot, history, current, changedAssets),
  deleteFabricatorSlot: (slot) => ipcRenderer.invoke('fabricator:delete-slot', slot),
  listFabricatorPoseSlots: () => ipcRenderer.invoke('fabricator:poses:list'),
  loadFabricatorPose: (slot) => ipcRenderer.invoke('fabricator:poses:load', slot),
  saveFabricatorPose: (slot, project, assets) => ipcRenderer.invoke('fabricator:poses:save', slot, project, assets),
  deleteFabricatorPose: (slot) => ipcRenderer.invoke('fabricator:poses:delete', slot),
  loadFabricatorPoseDraft: () => ipcRenderer.invoke('fabricator:poses:draft:load'),
  saveFabricatorPoseDraft: (draft, assets) => ipcRenderer.invoke('fabricator:poses:draft:save', draft, assets),
  deleteFabricatorPoseDraft: () => ipcRenderer.invoke('fabricator:poses:draft:delete')
}

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  appName: 'Gacha Nymi',
  ...fabricatorApi
})
