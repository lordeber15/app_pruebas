/**
 * Fechas de calendario (AAAA-MM-DD) del cronograma. Se guardan como `date` en la BD; «hoy» se
 * calcula en la zona del proyecto (`America/Lima` por defecto) y solo para comparar.
 */

const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const DIA_MS = 86_400_000;

const aUtc = (iso: string): number => {
  const m = FECHA.exec(iso);
  if (m === null) throw new Error(`Fecha inválida: ${iso}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};

/** Días de `desde` a `hasta` (negativo si `hasta` es anterior). */
export const diasEntre = (desde: string, hasta: string): number =>
  Math.round((aUtc(hasta) - aUtc(desde)) / DIA_MS);

/** La fecha `dias` días después (o antes, si es negativo). */
export const sumarDias = (iso: string, dias: number): string =>
  new Date(aUtc(iso) + dias * DIA_MS).toISOString().slice(0, 10);

/** Fecha de calendario de un instante en una zona horaria IANA. */
export const fechaEnZona = (instante: Date, zona = 'America/Lima'): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instante);
