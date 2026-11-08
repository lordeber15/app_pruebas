import { consultar, ejecutar } from './bd.ts';
import { avisarCambio } from './estado.ts';
import { registrarEvento } from './eventos.ts';
import { generarId } from './plataforma.ts';

/**
 * Jornada (RN-23, RF-M18): mecanismo del proveedor para tiempos de esfuerzo y avisos locales. No
 * hay tracking continuo de jornada (RN-24): solo se registran la apertura y el cierre.
 */
export const jornadaAbierta = async () =>
  (
    await consultar<{ id: string; abierta_en: string }>(
      'SELECT id, abierta_en FROM jornada_local WHERE cerrada_en IS NULL LIMIT 1',
    )
  )[0] ?? null;

export const abrirJornada = async () => {
  const id = generarId();
  await registrarEvento({
    tipo: 'jornada_iniciada',
    entidad: { tipo: 'jornada', id },
    payload: {},
  });
  await ejecutar('INSERT INTO jornada_local (id, abierta_en) VALUES (?, ?)', [
    id,
    new Date().toISOString(),
  ]);
  avisarCambio();
};

export const cerrarJornada = async (id: string) => {
  await registrarEvento({
    tipo: 'jornada_cerrada',
    entidad: { tipo: 'jornada', id },
    payload: { automatica: false },
  });
  await ejecutar('UPDATE jornada_local SET cerrada_en = ? WHERE id = ?', [
    new Date().toISOString(),
    id,
  ]);
  avisarCambio();
};
