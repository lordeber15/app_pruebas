import type { EstadoTarea } from '../api.ts';

/**
 * Marca de estado de la tarea: cada estado tiene una forma propia además de su color y su texto,
 * así el color nunca es el único indicador (WCAG 1.4.1). Es la misma marca en la lista, el mapa y
 * el detalle.
 */
export const ETIQUETA_ESTADO: Readonly<Record<EstadoTarea, string>> = {
  pendiente: 'Pendiente',
  asignada: 'Asignada',
  descargada: 'En el celular',
  en_transito: 'Evidencia en tránsito',
  completada: 'Completada',
  validada: 'Validada',
  observada: 'Observada',
  cerrada: 'Cerrada',
};

export const COLOR_ESTADO: Readonly<Record<EstadoTarea, string>> = {
  pendiente: '#4a5a54',
  asignada: '#4a5a54',
  descargada: '#2e5e4e',
  en_transito: '#a86f1e',
  completada: '#2e5e4e',
  validada: '#224639',
  observada: '#a86f1e',
  cerrada: '#18231f',
};

const Forma = ({ estado, color }: { estado: EstadoTarea; color: string }) => {
  switch (estado) {
    case 'pendiente':
      return (
        <circle
          cx="8"
          cy="8"
          r="5.5"
          fill="none"
          stroke={color}
          strokeWidth="1.6"
          strokeDasharray="2.2 2"
        />
      );
    case 'asignada':
      return <circle cx="8" cy="8" r="5.5" fill="none" stroke={color} strokeWidth="1.8" />;
    case 'descargada':
      return (
        <>
          <circle cx="8" cy="8" r="5.5" fill="none" stroke={color} strokeWidth="1.8" />
          <path d="M8 2.5 A5.5 5.5 0 0 1 8 13.5 Z" fill={color} />
        </>
      );
    case 'en_transito':
      return (
        <path
          d="M8 2.2 L14 13.2 H2 Z"
          fill="none"
          stroke={color}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      );
    case 'completada':
      return <circle cx="8" cy="8" r="6" fill={color} />;
    case 'validada':
      return (
        <>
          <circle cx="8" cy="8" r="6.5" fill={color} />
          <path
            d="M5 8.2 L7.2 10.3 L11 6"
            fill="none"
            stroke="#fff"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );
    case 'observada':
      return <path d="M8 1.8 L14.2 8 L8 14.2 L1.8 8 Z" fill={color} />;
    case 'cerrada':
      return <rect x="2.5" y="2.5" width="11" height="11" rx="1" fill={color} />;
  }
};

export const MarcaEstado = ({ estado, tamano = 16 }: { estado: EstadoTarea; tamano?: number }) => (
  <svg width={tamano} height={tamano} viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
    <Forma estado={estado} color={COLOR_ESTADO[estado]} />
  </svg>
);

export const Estado = ({ estado }: { estado: EstadoTarea }) => (
  <span
    className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm"
    style={{ color: COLOR_ESTADO[estado] }}
  >
    <MarcaEstado estado={estado} />
    <span className="font-medium">{ETIQUETA_ESTADO[estado]}</span>
  </span>
);

/** Leyenda completa: sirve en el mapa y en el avance. */
export const LeyendaEstados = ({ estados }: { estados: readonly EstadoTarea[] }) => (
  <ul className="flex flex-wrap gap-x-4 gap-y-1">
    {estados.map((e) => (
      <li key={e}>
        <Estado estado={e} />
      </li>
    ))}
  </ul>
);
