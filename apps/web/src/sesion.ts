import { useQuery } from '@tanstack/react-query';
import { api, type Yo } from './api.ts';

export const useYo = () =>
  useQuery({ queryKey: ['yo'], queryFn: () => api.get<Yo>('/yo'), staleTime: 60_000 });

/** Lo que la interfaz muestra según el rol (ERS §2.3). La API vuelve a autorizar cada acción. */
export const puede = (yo: Yo | undefined) => {
  const gestion = yo?.rol_global === 'coordinacion' || yo?.rol_global === 'jefe_proyecto';
  return {
    /** Coordinación y Jefe de Proyecto: configuran el proyecto, sus brigadas y revisiones. */
    gestionar: gestion,
    administrar: gestion || yo?.rol_global === 'admin',
    /** Los integrantes de una brigada los ven Coordinación, JdP y su Jefe de Brigada (RN-25). */
    verMiembros: (brigadaId: string): boolean =>
      gestion ||
      (yo?.membresias.some((m) => m.brigada_id === brigadaId && m.rol === 'jefe_brigada') ?? false),
  };
};
