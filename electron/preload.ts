import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { EodReport, GameApi, GameState, Notice } from './types'

function subscribe<T>(channel: string, listener: (payload: T) => void) {
  const handler = (_event: IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const api: GameApi = {
  listSaves: () => ipcRenderer.invoke('saves:list'),
  newGame: (companyName, capitalization) => ipcRenderer.invoke('saves:new', companyName, capitalization),
  loadGame: (saveId) => ipcRenderer.invoke('saves:load', saveId),
  deleteSave: (saveId) => ipcRenderer.invoke('saves:delete', saveId),
  saveCopy: () => ipcRenderer.invoke('saves:copy'),
  saveGame: () => ipcRenderer.invoke('saves:save'),
  exitToMenu: () => ipcRenderer.invoke('saves:exit'),
  getState: () => ipcRenderer.invoke('game:getState'),
  getEodReport: () => ipcRenderer.invoke('game:getEodReport'),
  pause: () => ipcRenderer.invoke('game:pause'),
  resume: () => ipcRenderer.invoke('game:resume'),
  startNextDay: () => ipcRenderer.invoke('game:startNextDay'),
  getLedger: () => ipcRenderer.invoke('game:getLedger'),
  getReportHistory: () => ipcRenderer.invoke('game:getReportHistory'),
  buyEquipment: (type) => ipcRenderer.invoke('game:buyEquipment', type),
  sellEquipment: (id) => ipcRenderer.invoke('game:sellEquipment', id),
  assignStation: (employeeId, equipmentId) => ipcRenderer.invoke('game:assignStation', employeeId, equipmentId),
  getMarketHistory: () => ipcRenderer.invoke('game:getMarketHistory'),
  getContractHistory: () => ipcRenderer.invoke('game:getContractHistory'),
  orderLumber: (mill, species, bundles, vehicleId) => ipcRenderer.invoke('game:orderLumber', mill, species, bundles, vehicleId),
  acceptContract: (id) => ipcRenderer.invoke('game:acceptContract', id),
  declineContract: (id) => ipcRenderer.invoke('game:declineContract', id),
  deliverContract: (id) => ipcRenderer.invoke('game:deliverContract', id),
  shipContract: (id, vehicleId) => ipcRenderer.invoke('game:shipContract', id, vehicleId),
  postJob: (tier) => ipcRenderer.invoke('game:postJob', tier),
  hireCandidate: (id) => ipcRenderer.invoke('game:hireCandidate', id),
  fireEmployee: (id) => ipcRenderer.invoke('game:fireEmployee', id),
  acquireProperty: (type, tenure) => ipcRenderer.invoke('game:acquireProperty', type, tenure),
  releaseProperty: (id) => ipcRenderer.invoke('game:releaseProperty', id),
  hireCrew: (role) => ipcRenderer.invoke('game:hireCrew', role),
  fireCrew: (id) => ipcRenderer.invoke('game:fireCrew', id),
  buyVehicle: (type) => ipcRenderer.invoke('game:buyVehicle', type),
  sellVehicle: (id) => ipcRenderer.invoke('game:sellVehicle', id),
  serviceVehicle: (id) => ipcRenderer.invoke('game:serviceVehicle', id),
  repayLoan: (amount) => ipcRenderer.invoke('game:repayLoan', amount),
  onState: (listener) => subscribe<GameState>('game:state', listener),
  onEndOfDay: (listener) => subscribe<EodReport>('game:eod', listener),
  onNotice: (listener) => subscribe<Notice>('game:notice', listener),
}

contextBridge.exposeInMainWorld('api', api)
