import { createContext, useContext } from 'react';

/**
 * True while one sheet gives the screen straight to the next (a quick view's
 * Edit, say): the outgoing panel fades where it stands, the scrim stays up,
 * and the next sheet arrives over it. Only a close to no sheet fades the scrim.
 * Provided by App's sheet host; its own module so the sheets need not load App.
 */
export const SheetHandoff = createContext(false);

export const useSheetHandoff = (): boolean => useContext(SheetHandoff);
