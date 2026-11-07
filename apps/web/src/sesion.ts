import { useQuery } from '@tanstack/react-query';
import { api, type Yo } from './api.ts';

export const useYo = () =>
  useQuery({ queryKey: ['yo'], queryFn: () => api.get<Yo>('/yo'), staleTime: 60_000 });

/** Lo que la interfaz muestra según el rol. La API vuelve a autorizar cada acción. */
export const puede = (yo: Yo | undefined) => ({
  supervisor: yo?.rol_global === 'supervisor',
  administrar: yo?.rol_global === 'supervisor' || yo?.rol_global === 'admin',
  gestionarTareas: yo?.rol_global === 'supervisor' || (yo?.cuadrillas_jefe.length ?? 0) > 0,
});
