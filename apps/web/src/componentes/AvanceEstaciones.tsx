import { ETIQUETA_ESTADO_ESTACION } from '@campo/core';
import { useMemo, useState } from 'react';
import type { EstacionAvance, EstadoEstacion } from '../api.ts';
import { Mapa, type MarcadorMapa } from './MapaDiferido.tsx';

/**
 * Estado y avance de cada estación (métodos completos / aplicables). Forma + ícono + texto: el
 * color nunca es el único indicador; los colores del fondo contrastan al menos 4,5:1 con su ícono.
 */
export const ESTILO_ESTADO: Readonly<
  Record<
    EstadoEstacion,
    { icono: string; forma: MarcadorMapa['forma']; fondo: string; tinta: string }
  >
> = {
  completa: { icono: '✓', forma: 'circulo', fondo: '#224639', tinta: '#ffffff' },
  en_curso: { icono: '▸', forma: 'circulo', fondo: '#1d4f91', tinta: '#ffffff' },
  con_incumplimiento: { icono: '!', forma: 'rombo', fondo: '#9b2c1f', tinta: '#ffffff' },
  reprogramada: { icono: '↻', forma: 'cuadrado', fondo: '#7a4f12', tinta: '#ffffff' },
  sin_datos: { icono: '?', forma: 'cuadrado', fondo: '#ffffff', tinta: '#18231f' },
  sin_iniciar: { icono: '–', forma: 'circulo', fondo: '#ffffff', tinta: '#18231f' },
};

const ORDEN: readonly EstadoEstacion[] = [
  'completa',
  'en_curso',
  'con_incumplimiento',
  'reprogramada',
  'sin_datos',
  'sin_iniciar',
];

const porcentaje = (n: number): string =>
  `${new Intl.NumberFormat('es-PE', { maximumFractionDigits: 1 }).format(n)} %`;

/** Insignia del estado: forma e ícono iguales a los del mapa, con su texto. */
export const InsigniaEstado = ({ estado }: { estado: EstadoEstacion }) => {
  const e = ESTILO_ESTADO[estado];
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-sm">
      <span
        aria-hidden="true"
        className="inline-flex size-5 items-center justify-center text-xs font-bold"
        style={{
          background: e.fondo,
          color: e.tinta,
          borderRadius: e.forma === 'circulo' ? '9999px' : '3px',
          transform: e.forma === 'rombo' ? 'rotate(45deg) scale(0.85)' : undefined,
          boxShadow: '0 0 0 1px rgba(24,35,31,0.55)',
        }}
      >
        <span style={{ transform: e.forma === 'rombo' ? 'rotate(-45deg)' : undefined }}>
          {e.icono}
        </span>
      </span>
      {ETIQUETA_ESTADO_ESTACION[estado]}
    </span>
  );
};

/** «4 de 7 · 57 %» + barra + estado. Sin ejecuciones no se muestra 0 % (RN-37). */
export const CeldaAvance = ({ a }: { a: EstacionAvance['avance'] }) => {
  const texto =
    a.aplicables === 0
      ? 'Sin métodos aplicables'
      : `${String(a.completos)} de ${String(a.aplicables)}${a.porcentaje === null ? ' · sin datos' : ` · ${porcentaje(a.porcentaje)}`}`;
  return (
    <div className="flex min-w-40 flex-col gap-1">
      <span className="cifras text-sm font-semibold">{texto}</span>
      {a.porcentaje === null ? null : (
        <span
          className="h-2 w-full overflow-hidden rounded-full bg-linea"
          role="img"
          aria-label={`${porcentaje(a.porcentaje)} de métodos completos`}
        >
          <span
            className="block h-full bg-liquen"
            style={{ width: `${String(Math.min(100, a.porcentaje))}%` }}
          />
        </span>
      )}
      <InsigniaEstado estado={a.estado} />
    </div>
  );
};

const fechaCorta = (iso: string | null): string => {
  if (iso === null) return 'Sin programar';
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('es-PE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1));
};

/** Mapa de estaciones coloreado por estado, con leyenda y detalle de la estación elegida. */
export const MapaAvance = ({
  estaciones,
  alto = '24rem',
}: {
  estaciones: readonly EstacionAvance[];
  alto?: string;
}) => {
  const [elegida, setElegida] = useState<string | null>(null);
  const marcadores = useMemo(
    () =>
      estaciones.map((s): MarcadorMapa => {
        const e = ESTILO_ESTADO[s.avance.estado];
        const p = s.avance.porcentaje === null ? 'sin datos' : porcentaje(s.avance.porcentaje);
        return {
          id: s.id,
          lat: s.lat,
          lon: s.lon,
          etiqueta: `${s.codigo}: ${ETIQUETA_ESTADO_ESTACION[s.avance.estado]}, ${String(s.avance.completos)} de ${String(s.avance.aplicables)} métodos (${p})`,
          icono: e.icono,
          forma: e.forma,
          fondo: e.fondo,
          tinta: e.tinta,
          elegido: s.id === elegida,
        };
      }),
    [estaciones, elegida],
  );
  const cuenta = new Map<EstadoEstacion, number>();
  for (const s of estaciones) cuenta.set(s.avance.estado, (cuenta.get(s.avance.estado) ?? 0) + 1);
  const detalle = estaciones.find((s) => s.id === elegida);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
      <Mapa
        puntos={[]}
        marcadores={marcadores}
        alElegir={setElegida}
        alto={alto}
        etiqueta="Mapa del estado de las estaciones"
      />
      <div className="flex flex-col gap-4">
        <section
          aria-labelledby="leyenda-estado"
          className="rounded-md border border-linea bg-hoja p-3"
        >
          <h3 id="leyenda-estado" className="mb-2 text-sm font-semibold">
            Estado de las estaciones
          </h3>
          <ul className="flex flex-col gap-1">
            {ORDEN.map((e) => (
              <li key={e} className="flex items-center justify-between gap-2">
                <InsigniaEstado estado={e} />
                <span className="cifras text-sm text-tinta-suave">{cuenta.get(e) ?? 0}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-tinta-suave">
            Avance = métodos completos / métodos aplicables de la estación. Elija un punto para ver
            su detalle.
          </p>
        </section>
        {detalle === undefined ? null : (
          <section
            aria-live="polite"
            aria-labelledby="detalle-estacion"
            className="rounded-md border border-linea bg-hoja p-3 text-sm"
          >
            <h3 id="detalle-estacion" className="text-base font-semibold">
              {detalle.codigo}
            </h3>
            <div className="my-2">
              <CeldaAvance a={detalle.avance} />
            </div>
            <p>
              Brigada: <strong>{detalle.brigada ?? 'Sin asignar'}</strong>
            </p>
            <p>
              Programada: <strong>{fechaCorta(detalle.fecha_programada)}</strong>
              {detalle.reprogramada ? ' (reprogramada)' : ''}
            </p>
            {detalle.metodos.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1">
                {detalle.metodos.map((m) => (
                  <li key={m.metodo_id} className="flex justify-between gap-2">
                    <span>
                      <span aria-hidden="true">{m.completo ? '✓ ' : '· '}</span>
                      {m.metodo_nombre}
                    </span>
                    <span className="cifras whitespace-nowrap text-tinta-suave">
                      {m.completo
                        ? 'Completo'
                        : m.ejecuciones === 0
                          ? 'Sin datos'
                          : m.porcentaje === null
                            ? 'En curso'
                            : porcentaje(m.porcentaje)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        )}
      </div>
    </div>
  );
};
