import {
  esRolBrigada,
  tiposDeAlerta,
  type CategoriaAlertaLogistica,
  type TipoAlertaRegistrable,
} from '@campo/core';
import { consultar, ejecutar } from './bd.ts';
import type { Paquete } from './campo.ts';
import { avisarCambio } from './estado.ts';
import { registrarEvento } from './eventos.ts';
import { generarId } from './plataforma.ts';

/**
 * Alertas registradas en campo sin señal (D02 §9 y §13, RN-36): registros estructurados de
 * excepción, no tareas ni chat. Se guardan en local y se encolan como evento; hasta que el
 * servidor responde quedan «pendientes de envío» (`pendiente_sync`). El tipo que cada rol puede
 * registrar lo decide core (`tiposDeAlerta`); la API lo vuelve a verificar.
 */

export interface BrigadaParaAlerta {
  id: string;
  nombre: string;
  tipos: readonly TipoAlertaRegistrable[];
}

/** Brigadas del paquete en las que el rol del usuario puede registrar alguna alerta. */
export const brigadasParaAlerta = (p: Paquete): BrigadaParaAlerta[] =>
  p.brigadas.flatMap((b) => {
    if (!esRolBrigada(b.rol)) return [];
    const tipos = tiposDeAlerta(b.rol).filter(
      (t): t is TipoAlertaRegistrable => t === 'tecnica' || t === 'logistica',
    );
    return tipos.length === 0 ? [] : [{ id: b.id, nombre: b.codigo ?? b.nombre, tipos }];
  });

/**
 * Brigada a la que va la alerta: la de la reserva o el cronograma de la estación si el usuario
 * está en ella; si no, la primera en la que puede registrar alertas.
 */
export const brigadaSugerida = (
  p: Paquete,
  brigadas: readonly BrigadaParaAlerta[],
  estacionId: string | null,
  reservaId: string | null,
): string | null => {
  const ids = new Set(brigadas.map((b) => b.id));
  const candidatas = [
    ...p.reservas.filter((r) => r.id === reservaId).map((r) => r.brigada_id),
    ...p.reservas.filter((r) => r.estacion_id === estacionId).map((r) => r.brigada_id),
    ...p.cronograma.filter((i) => i.estacion_id === estacionId).map((i) => i.brigada_id),
  ];
  return candidatas.find((id) => ids.has(id)) ?? brigadas[0]?.id ?? null;
};

export interface NuevaAlertaLocal {
  brigadaId: string;
  tipo: TipoAlertaRegistrable;
  categoria: CategoriaAlertaLogistica | null;
  titulo: string;
  descripcion: string | null;
  estacionId: string | null;
  ejecucionId: string | null;
  reservaId: string | null;
  afectaCronograma: boolean;
}

/** Guarda la alerta y encola su evento. Nunca espera a la red (RNF-01). */
export const registrarAlerta = async (a: NuevaAlertaLocal): Promise<string> => {
  const id = generarId();
  const eventoId = await registrarEvento({
    tipo: 'alerta_local_generada',
    entidad: { tipo: 'alerta', id },
    payload: {
      alerta_id: id,
      brigada_id: a.brigadaId,
      tipo: a.tipo,
      categoria: a.tipo === 'logistica' ? a.categoria : null,
      titulo: a.titulo.trim(),
      descripcion:
        a.descripcion === null || a.descripcion.trim() === '' ? null : a.descripcion.trim(),
      estacion_id: a.estacionId,
      ejecucion_id: a.ejecucionId,
      reserva_id: a.reservaId,
      afecta_cronograma: a.afectaCronograma,
    },
  });
  await ejecutar(
    `INSERT INTO alerta_local (id, evento_id, brigada_id, tipo, categoria, titulo, descripcion,
       estacion_id, ejecucion_id, reserva_id, afecta_cronograma, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      eventoId,
      a.brigadaId,
      a.tipo,
      a.tipo === 'logistica' ? a.categoria : null,
      a.titulo.trim(),
      a.descripcion,
      a.estacionId,
      a.ejecucionId,
      a.reservaId,
      a.afectaCronograma ? 1 : 0,
      new Date().toISOString(),
    ],
  );
  avisarCambio();
  return id;
};

export interface AlertaLocal {
  id: string;
  brigada_id: string;
  tipo: TipoAlertaRegistrable;
  categoria: CategoriaAlertaLogistica | null;
  titulo: string;
  descripcion: string | null;
  estacion_id: string | null;
  ejecucion_id: string | null;
  afecta_cronograma: number;
  creado_en: string;
  resultado: string | null;
  motivo: string | null;
}

export const misAlertas = () =>
  consultar<AlertaLocal>('SELECT * FROM alerta_local ORDER BY creado_en DESC LIMIT 200');

export type EstadoAlertaLocal = 'pendiente_sync' | 'enviada' | 'no_aceptada';

/** Estado visible en el celular: solo sabe si salió y si el servidor la aceptó. */
export const estadoLocal = (resultado: string | null): EstadoAlertaLocal =>
  resultado === null
    ? 'pendiente_sync'
    : resultado === 'aplicado' || resultado === 'ya_aplicado' || resultado === 'en_revision'
      ? 'enviada'
      : 'no_aceptada';

export const ETIQUETA_ESTADO_LOCAL: Readonly<Record<EstadoAlertaLocal, string>> = {
  pendiente_sync: 'Pendiente de envío',
  enviada: 'Enviada',
  no_aceptada: 'No aceptada',
};

/** Por qué el servidor no aceptó una alerta (motivos de la API). */
export const explicarMotivo = (motivo: string | null): string => {
  switch (motivo) {
    case 'TIPO_NO_PERMITIDO':
      return 'Su rol en la brigada no registra este tipo de alerta.';
    case 'FUERA_DE_ALCANCE':
      return 'Usted ya no figura en esa brigada o el proyecto está cerrado.';
    case 'REFERENCIA_INVALIDA':
      return 'La estación o la ejecución no corresponden a la brigada.';
    default:
      return 'El servidor no la aceptó. Coordinación puede revisarla.';
  }
};

export const ETIQUETA_TIPO: Readonly<Record<TipoAlertaRegistrable, string>> = {
  tecnica: 'Técnica',
  logistica: 'Logística',
};
