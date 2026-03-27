// AFINN-165 word list re-export
// 3382 English words scored from -5 (most negative) to +5 (most positive)

import { afinn165 } from "afinn-165";

export const afinn: Record<string, number> = afinn165;
