// Barrel export — import anything from '@/utils'
// For large files (firebase, validation) prefer direct imports to keep bundles lean

export * from './images';
export * from './icons';
export * from './constants';
export * from './helpers';
export * from './format';
export * from './routes';
export * from './currency';
export * from './date';
export * from './sidebar';
export * from './logger';
// firebase and api are intentionally NOT barrel-exported:
// they must be imported directly to keep SSR bundles clean.
// e.g. import { db } from '@/utils/firebase';
//      import { apiCall } from '@/utils/api';
