import { ZONA_HORARIA_POR_DEFECTO, type Orientacion, type TipoFoto } from '@campo/core';

/**
 * Texto del sello que se imprime sobre cada foto de evidencia (decisión del usuario, 2026-11-08):
 * coordenadas con su precisión, fecha y hora local, estación, método, unidad y tipo de foto. La
 * coordenada también queda como dato del archivo (F-02): el sello no la sustituye.
 */

export const TIPO_FOTO_TEXTO: Readonly<Record<TipoFoto, string>> = {
  contexto: 'Foto de contexto',
  metodologica: 'Foto metodológica',
  primer_plano: 'Primer plano',
  cientifica: 'Foto científica',
};

const NOMBRE_ORIENTACION: Readonly<Record<Orientacion, string>> = {
  N: 'norte',
  S: 'sur',
  E: 'este',
  O: 'oeste',
};

/** `dd/mm/aaaa HH:mm` en la zona del proyecto (por defecto `America/Lima`). */
export const fechaSello = (d: Date, zona = ZONA_HORARIA_POR_DEFECTO): string => {
  const partes = new Intl.DateTimeFormat('es-PE', {
    timeZone: zona,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const p = (t: Intl.DateTimeFormatPartTypes) => partes.find((x) => x.type === t)?.value ?? '';
  return `${p('day')}/${p('month')}/${p('year')} ${p('hour')}:${p('minute')}`;
};

export interface DatosSello {
  readonly ubicacion: { lat: number; lon: number; precision_m?: number } | null;
  readonly capturadoEn: Date;
  readonly estacion: string | null;
  readonly metodo: string | null;
  readonly unidad: string | null;
  readonly tipoFoto: TipoFoto;
  readonly orientacion: Orientacion | null;
}

export const lineasSello = (d: DatosSello): string[] => {
  const u = d.ubicacion;
  const gps =
    u === null
      ? 'Sin GPS'
      : `Lat ${u.lat.toFixed(5)}   Lon ${u.lon.toFixed(5)}${
          u.precision_m === undefined ? '' : `   ±${String(Math.round(u.precision_m))} m`
        }`;
  const lugar = [d.estacion === null ? null : `Estación ${d.estacion}`, d.metodo].filter(
    (x): x is string => x !== null && x !== '',
  );
  const foto = [
    d.unidad === null ? null : `Unidad ${d.unidad}`,
    TIPO_FOTO_TEXTO[d.tipoFoto],
    d.orientacion === null
      ? null
      : `Orientación ${NOMBRE_ORIENTACION[d.orientacion]} (${d.orientacion})`,
  ].filter((x): x is string => x !== null);
  return [gps, fechaSello(d.capturadoEn), lugar.join(' · '), foto.join(' · ')].filter(
    (x) => x !== '',
  );
};
