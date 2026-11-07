import { crearGeneradorUuidV7 } from '@campo/core';
import { randomFillSync } from 'node:crypto';

/** UUID v7 para las claves que genera el servidor (CLAUDE.md, Base de datos). */
export const generarId = crearGeneradorUuidV7((n) => randomFillSync(new Uint8Array(n)));
