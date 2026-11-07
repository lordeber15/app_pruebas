import { eventoSchema, type Evento } from '@campo/core';
import * as Location from 'expo-location';
import { ejecutar } from './bd.ts';
import { generarId } from './plataforma.ts';
import { avisarCambio } from './estado.ts';

/**
 * Todo lo que se hace en campo se guarda primero como evento en la outbox local (RNF-01): ningún
 * flujo espera a la red. El evento se valida con el mismo esquema que usa la API (core).
 */
type Sobre<T extends Evento['tipo']> = Omit<
  Extract<Evento, { tipo: T }>,
  'id' | 'version_esquema' | 'hora_dispositivo' | 'ubicacion' | 'usuario_id' | 'dispositivo_id'
>;

/** Ubicación del momento, si está disponible rápido. Nunca bloquea el registro. */
export const ubicacionActual = async (): Promise<Evento['ubicacion']> => {
  try {
    const permiso = await Location.getForegroundPermissionsAsync();
    if (!permiso.granted) return null;
    const pos =
      (await Location.getLastKnownPositionAsync({ maxAge: 60_000, requiredAccuracy: 100 })) ??
      (await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<null>((r) => setTimeout(() => r(null), 8_000)),
      ]));
    if (pos === null) return null;
    return {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      ...(pos.coords.accuracy === null ? {} : { precision_m: pos.coords.accuracy }),
      ...(pos.coords.altitude === null ? {} : { altitud_m: pos.coords.altitude }),
    };
  } catch {
    return null;
  }
};

export const registrarEvento = async <T extends Evento['tipo']>(
  sobre: Sobre<T> & { tipo: T },
  ubicacion?: Evento['ubicacion'],
): Promise<string> => {
  const evento = {
    ...sobre,
    id: generarId(),
    version_esquema: 1,
    hora_dispositivo: new Date().toISOString(),
    ubicacion: ubicacion === undefined ? await ubicacionActual() : ubicacion,
  };
  const r = eventoSchema.safeParse(evento);
  if (!r.success) throw new Error(`Evento inválido: ${r.error.issues[0]?.message ?? 'formato'}`);
  await ejecutar('INSERT INTO outbox (id, tipo, cuerpo, creado_en) VALUES (?, ?, ?, ?)', [
    evento.id,
    evento.tipo,
    JSON.stringify(evento),
    evento.hora_dispositivo,
  ]);
  avisarCambio();
  return evento.id;
};
