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
  listFabricatorPoseSlots: (modelSlot) => ipcRenderer.invoke('fabricator:poses:list', modelSlot),
  loadFabricatorPose: (modelSlot, slot) => ipcRenderer.invoke('fabricator:poses:load', modelSlot, slot),
  saveFabricatorPose: (modelSlot, slot, project, assets) => ipcRenderer.invoke('fabricator:poses:save', modelSlot, slot, project, assets),
  deleteFabricatorPose: (modelSlot, slot) => ipcRenderer.invoke('fabricator:poses:delete', modelSlot, slot),
  loadFabricatorPoseDraft: (modelSlot) => ipcRenderer.invoke('fabricator:poses:draft:load', modelSlot),
  saveFabricatorPoseDraft: (modelSlot, draft, assets) => ipcRenderer.invoke('fabricator:poses:draft:save', modelSlot, draft, assets),
  deleteFabricatorPoseDraft: (modelSlot) => ipcRenderer.invoke('fabricator:poses:draft:delete', modelSlot)
}

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  appName: 'Gacha Nymi',
  ...fabricatorApi
})
