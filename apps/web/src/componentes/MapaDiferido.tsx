import { lazy, Suspense, type ComponentProps } from 'react';
import { Cargando } from './Ui.tsx';

/** MapLibre pesa más de 1 MB: se descarga solo al abrir una pantalla con mapa. */
const MapaReal = lazy(async () => ({ default: (await import('./Mapa.tsx')).Mapa }));

export type { CapaMapa, PuntoMapa } from './Mapa.tsx';

export const Mapa = (props: ComponentProps<typeof MapaReal>) => (
  <Suspense fallback={<Cargando que="el mapa" />}>
    <MapaReal {...props} />
  </Suspense>
);
