import { contextBridge, ipcRenderer } from 'electron'
import type { FabricatorDesktopApi } from '../src/shared/fabricator'
import type { CustomizerDesktopApi } from '../src/shared/customizer'

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
  deleteFabricatorPoseDraft: (modelSlot) => ipcRenderer.invoke('fabricator:poses:draft:delete', modelSlot),
  listAnimatorAnimations: (modelSlot) => ipcRenderer.invoke('fabricator:animator:list', modelSlot),
  loadAnimatorAnimation: (modelSlot, slot) => ipcRenderer.invoke('fabricator:animator:load', modelSlot, slot),
  saveAnimatorAnimation: (modelSlot, slot, animation, assets) => ipcRenderer.invoke('fabricator:animator:save', modelSlot, slot, animation, assets),
  deleteAnimatorAnimation: (modelSlot, slot) => ipcRenderer.invoke('fabricator:animator:delete', modelSlot, slot),
  loadAnimatorDraft: (modelSlot) => ipcRenderer.invoke('fabricator:animator:draft:load', modelSlot),
  saveAnimatorDraft: (modelSlot, draft, assets) => ipcRenderer.invoke('fabricator:animator:draft:save', modelSlot, draft, assets),
  deleteAnimatorDraft: (modelSlot) => ipcRenderer.invoke('fabricator:animator:draft:delete', modelSlot),
  listWardrobeSets: (modelSlot) => ipcRenderer.invoke('fabricator:wardrobe:list', modelSlot),
  loadWardrobeSet: (modelSlot, id) => ipcRenderer.invoke('fabricator:wardrobe:load', modelSlot, id),
  saveWardrobeSet: (modelSlot, set, assets) => ipcRenderer.invoke('fabricator:wardrobe:save', modelSlot, set, assets),
  deleteWardrobeSet: (modelSlot, id) => ipcRenderer.invoke('fabricator:wardrobe:delete', modelSlot, id),
  listFaceSets: (modelSlot) => ipcRenderer.invoke('fabricator:face:list', modelSlot),
  loadFaceSet: (modelSlot, id) => ipcRenderer.invoke('fabricator:face:load', modelSlot, id),
  saveFaceSet: (modelSlot, set, assets) => ipcRenderer.invoke('fabricator:face:save', modelSlot, set, assets),
  deleteFaceSet: (modelSlot, id) => ipcRenderer.invoke('fabricator:face:delete', modelSlot, id),
  listFaceCatalog: (modelSlot) => ipcRenderer.invoke('fabricator:face-catalog:list', modelSlot),
  loadFaceCatalogItem: (modelSlot, id) => ipcRenderer.invoke('fabricator:face-catalog:load', modelSlot, id),
  saveFaceCatalogItem: (modelSlot, item, assets) => ipcRenderer.invoke('fabricator:face-catalog:save', modelSlot, item, assets),
  deleteFaceCatalogItem: (modelSlot, id) => ipcRenderer.invoke('fabricator:face-catalog:delete', modelSlot, id),
  loadHairWorkspace: (modelSlot) => ipcRenderer.invoke('fabricator:hair:load', modelSlot),
  saveHairWorkspace: (modelSlot, workspace, assets) => ipcRenderer.invoke('fabricator:hair:save', modelSlot, workspace, assets),
  listHairStyles: (modelSlot) => ipcRenderer.invoke('fabricator:hair:styles:list', modelSlot),
  loadHairStyle: (modelSlot, id) => ipcRenderer.invoke('fabricator:hair:styles:load', modelSlot, id),
  saveHairStyle: (modelSlot, style, assets) => ipcRenderer.invoke('fabricator:hair:styles:save', modelSlot, style, assets),
  deleteHairStyle: (modelSlot, id) => ipcRenderer.invoke('fabricator:hair:styles:delete', modelSlot, id)
}

const customizerApi: CustomizerDesktopApi = {
  listCustomizerCharacters: () => ipcRenderer.invoke('customizer:characters:list'),
  saveCustomizerCharacter: (character) => ipcRenderer.invoke('customizer:characters:save', character),
  createCustomizerCharacter: (name) => ipcRenderer.invoke('customizer:characters:create', name),
  deleteCustomizerCharacter: (id) => ipcRenderer.invoke('customizer:characters:delete', id)
}

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  appName: 'Gacha Nymi',
  ...fabricatorApi,
  ...customizerApi
})
