import { EventEmitter } from 'node:events';
export const searchEvents = new EventEmitter();
// Called only after PG commit. Startup/daily reconciliation recovers an interrupted process.
export function requestSearchSync(caseId:string):void { searchEvents.emit('case',caseId); }
