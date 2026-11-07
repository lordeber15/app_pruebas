/**
 * Horarios de D01 (RN-41): ventanas `HH:MM–HH:MM` en la hora local del proyecto. Las horas se
 * guardan en UTC (CLAUDE.md); aquí se convierten solo para comparar. Una ventana cuyo fin es
 * menor o igual que su inicio cruza la medianoche (18:00–06:00, 17:30–00:00).
 */
export interface VentanaHoraria {
  readonly inicio: string;
  readonly fin: string;
}

export const ZONA_HORARIA_POR_DEFECTO = 'America/Lima';

const MINUTOS_DIA = 24 * 60;

export const aMinutos = (hhmm: string): number => {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
};

const formateadores = new Map<string, Intl.DateTimeFormat>();

const formateador = (zona: string): Intl.DateTimeFormat => {
  const f = formateadores.get(zona);
  if (f !== undefined) return f;
  // Lanza RangeError si la zona no existe: mejor fallar al configurar que comparar mal.
  const nuevo = new Intl.DateTimeFormat('en-GB', {
    timeZone: zona,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  formateadores.set(zona, nuevo);
  return nuevo;
};

/** Minutos desde la medianoche local de un instante ISO; `null` si la fecha no es válida. */
export const minutosLocales = (iso: string, zona: string): number | null => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const partes = formateador(zona).formatToParts(new Date(t));
  const hora = partes.find((p) => p.type === 'hour')?.value;
  const minuto = partes.find((p) => p.type === 'minute')?.value;
  if (hora === undefined || minuto === undefined) return null;
  // Algunos motores devuelven «24» a medianoche con h23 en ciertas combinaciones.
  return (Number(hora) % 24) * 60 + Number(minuto);
};

export const dentroDeVentana = (minutos: number, ventana: VentanaHoraria): boolean => {
  const ini = aMinutos(ventana.inicio);
  let fin = aMinutos(ventana.fin);
  if (fin <= ini) fin += MINUTOS_DIA;
  return (
    (minutos >= ini && minutos <= fin) ||
    (minutos + MINUTOS_DIA >= ini && minutos + MINUTOS_DIA <= fin)
  );
};

export const dentroDeAlgunaVentana = (
  minutos: number,
  ventanas: readonly VentanaHoraria[],
): boolean => ventanas.some((v) => dentroDeVentana(minutos, v));

export const describirVentanas = (ventanas: readonly VentanaHoraria[]): string =>
  ventanas.map((v) => `${v.inicio}–${v.fin}`).join(' y ');

/** Duración en minutos entre dos instantes ISO; `null` si falta alguno o no son válidos. */
export const duracionMinutos = (inicio: string | null, fin: string | null): number | null => {
  if (inicio === null || fin === null) return null;
  const a = Date.parse(inicio);
  const b = Date.parse(fin);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return (b - a) / 60_000;
};

/** HH:MM local de un instante, para mensajes. */
export const horaLocal = (iso: string, zona: string): string => {
  const m = minutosLocales(iso, zona);
  if (m === null) return '--:--';
  const h = Math.floor(m / 60);
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
