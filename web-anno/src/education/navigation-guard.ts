import { createContext, type MutableRefObject } from 'react';
/** Session logout must await the same draft queue as route navigation. */
export const EducationLeaveGuard = createContext<MutableRefObject<null|(()=>Promise<boolean>)>>({current:null});
