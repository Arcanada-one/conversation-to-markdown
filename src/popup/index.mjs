import * as api from './controls.mjs';
import { flushRunLog } from './logging.mjs';

globalThis.__c2mPopupApi = api;
Object.assign(globalThis, api, { flushRunLog });
