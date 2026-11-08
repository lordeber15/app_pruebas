import { describe, expect, it } from 'vitest';
import { eventoSchema, loteEventosSchema, respuestaLoteSchema } from './esquemas.ts';

const UUID_V7 = '0192f0c8-7a1e-7b2c-9d10-3f5e8a2b4c61';
const UUID_V4 = '3b241101-e2bb-4255-8caf-4136c566a962';
const ID = '0192f0c8-7a1e-7b2c-9d10-3f5e8a2b4c62';
const HASH = 'a'.repeat(64);

const sobre = {
  id: UUID_V7,
  version_esquema: 1,
  entidad: { tipo: 'ejecucion', id: ID },
  hora_dispositivo: '2026-11-10T15:42:07.120-05:00',
  ubicacion: { lat: -12.04, lon: -77.03, precision_m: 8, altitud_m: 154 },
} as const;

const ejecucionAbierta = {
  ...sobre,
  tipo: 'ejecucion_abierta',
  payload: {
    ejecucion_id: ID,
    reserva_id: ID,
    estacion_id: ID,
    metodo_id: ID,
    abierta_en: '2026-11-10T15:40:00-05:00',
  },
};

const fotoCapturada = {
  ...sobre,
  tipo: 'archivo_capturado',
  entidad: { tipo: 'archivo', id: ID },
  payload: {
    archivo_id: ID,
    tipo: 'foto',
    ejecucion_id: ID,
    hash_preview: HASH,
    hash_original: HASH,
    tamanos: { preview: 900_000, original: 6_000_000 },
    capturado_en: '2026-11-10T15:41:00-05:00',
  },
};

describe('sobre de evento (doc. 03 §9.1)', () => {
  it('acepta un evento de ejecución con su sobre', () => {
    expect(eventoSchema.safeParse(ejecucionAbierta).success).toBe(true);
  });

  it('RN-10 exige un UUID v7 como id del evento', () => {
    expect(eventoSchema.safeParse({ ...ejecucionAbierta, id: UUID_V4 }).success).toBe(false);
  });

  it('RN-09 acepta la hora del dispositivo con su zona horaria', () => {
    const r = eventoSchema.safeParse({
      ...ejecucionAbierta,
      hora_dispositivo: '2026-11-10T20:42:07Z',
    });
    expect(r.success).toBe(true);
  });

  it('rechaza un tipo de evento desconocido', () => {
    expect(eventoSchema.safeParse({ ...ejecucionAbierta, tipo: 'gasto_registrado' }).success).toBe(
      false,
    );
  });

  it('los eventos del modelo anterior ya no son parte del catálogo', () => {
    for (const tipo of ['tarea_completada', 'evidencia_item_creado', 'esfuerzo_registrado']) {
      expect(eventoSchema.safeParse({ ...ejecucionAbierta, tipo }).success).toBe(false);
    }
    expect(
      eventoSchema.safeParse({ ...ejecucionAbierta, entidad: { tipo: 'tarea', id: ID } }).success,
    ).toBe(false);
  });

  it('rechaza una versión de esquema no soportada', () => {
    expect(eventoSchema.safeParse({ ...ejecucionAbierta, version_esquema: 2 }).success).toBe(false);
  });

  it('rechaza coordenadas fuera de rango', () => {
    const r = eventoSchema.safeParse({ ...ejecucionAbierta, ubicacion: { lat: -95, lon: -77 } });
    expect(r.success).toBe(false);
  });
});

describe('catálogo de eventos v1 (doc. 03 §9.2)', () => {
  it('acepta el manifiesto de una foto con sus dos variantes', () => {
    expect(eventoSchema.safeParse(fotoCapturada).success).toBe(true);
  });

  it('una foto sin original (proyecto sin originales) es válida', () => {
    const p = {
      ...fotoCapturada.payload,
      hash_original: null,
      tamanos: { preview: 900_000, original: null },
    };
    expect(eventoSchema.safeParse({ ...fotoCapturada, payload: p }).success).toBe(true);
  });

  it('un audio no puede tener original (doc. 03 §10)', () => {
    const p = { ...fotoCapturada.payload, tipo: 'audio' };
    expect(eventoSchema.safeParse({ ...fotoCapturada, payload: p }).success).toBe(false);
  });

  it('el hash del original y su tamaño van juntos', () => {
    const p = { ...fotoCapturada.payload, tamanos: { preview: 900_000, original: null } };
    expect(eventoSchema.safeParse({ ...fotoCapturada, payload: p }).success).toBe(false);
  });

  it('rechaza un hash que no es SHA-256 en hexadecimal', () => {
    const p = { ...fotoCapturada.payload, hash_preview: 'XYZ' };
    expect(eventoSchema.safeParse({ ...fotoCapturada, payload: p }).success).toBe(false);
  });

  it('acepta los eventos de jornada sin datos adicionales', () => {
    const r = eventoSchema.safeParse({
      ...sobre,
      tipo: 'jornada_iniciada',
      entidad: { tipo: 'jornada', id: ID },
      payload: {},
    });
    expect(r.success).toBe(true);
  });
});

describe('lote y respuesta (doc. 03 §9.3)', () => {
  it('rechaza un lote vacío', () => {
    expect(loteEventosSchema.safeParse({ eventos: [] }).success).toBe(false);
  });

  it('acepta la respuesta del documento', () => {
    const r = respuestaLoteSchema.safeParse({
      resultados: [
        { id: UUID_V7, estado: 'aplicado' },
        { id: UUID_V7, estado: 'no_aplicado', motivo: 'EJECUCION_AJENA' },
      ],
      cursor_cambios: 'c1',
    });
    expect(r.success).toBe(true);
  });
});

describe('eventos de ejecución TOCE (RN-05, RN-24, RN-30, RF-M11)', () => {
  const base = sobre;
  const unidad = {
    ...base,
    tipo: 'unidad_guardada',
    entidad: { tipo: 'unidad', id: ID },
    payload: {
      unidad_id: ID,
      ejecucion_id: ID,
      codigo: 'P-01',
      tipo_unidad: 'punto',
      orden: 0,
      estado: 'cerrada',
      geometria: { tipo: 'punto', punto: { lat: -12, lon: -77 } },
      inicio: '2026-12-05T06:10:00-05:00',
      fin: '2026-12-05T06:20:00-05:00',
      datos: { habitat: 'Matorral', n: 3, en_vuelo: false, ubicacion: { lat: -12, lon: -77 } },
      registros: [{ especie: 'Zonotrichia capensis', n_individuos: 2 }],
      unidad_vinculada_id: null,
      parametros_confirmados: [],
    },
  };
  const cierre = {
    ...base,
    tipo: 'ejecucion_cerrada',
    entidad: { tipo: 'ejecucion', id: ID },
    payload: {
      ejecucion_id: ID,
      cerrada_en: '2026-12-05T11:00:00-05:00',
      datos: {},
      desviacion: { tipo: 'ninguna', explicacion: null },
      confirmaciones: ['za_ef_cantidad_exacta'],
      objetivo_campo: null,
      archivo_ids: [ID],
    },
  };

  it('acepta abrir, guardar unidad, track y cerrar con sus formatos', () => {
    expect(
      eventoSchema.safeParse({
        ...base,
        tipo: 'ejecucion_abierta',
        entidad: { tipo: 'ejecucion', id: ID },
        payload: {
          ejecucion_id: ID,
          reserva_id: null,
          estacion_id: ID,
          metodo_id: ID,
          abierta_en: '2026-12-05T06:00:00-05:00',
        },
      }).success,
    ).toBe(true);
    expect(eventoSchema.safeParse(unidad).success).toBe(true);
    expect(eventoSchema.safeParse(cierre).success).toBe(true);
    const punto = (hora: string) => ({ lat: -12, lon: -77, altitud_m: null, precision_m: 5, hora });
    expect(
      eventoSchema.safeParse({
        ...base,
        tipo: 'track_registrado',
        entidad: { tipo: 'track', id: ID },
        payload: {
          track_id: ID,
          ejecucion_id: ID,
          unidad_id: null,
          puntos: [punto('2026-12-05T06:00:00Z'), punto('2026-12-05T06:05:00Z')],
        },
      }).success,
    ).toBe(true);
  });

  it('RN-30 rechaza geometrías mal formadas y RN-24 un track desordenado o de un solo punto', () => {
    const geo = (g: unknown) =>
      eventoSchema.safeParse({ ...unidad, payload: { ...unidad.payload, geometria: g } }).success;
    expect(geo({ tipo: 'inicio_fin', inicio: { lat: -12, lon: -77 } })).toBe(false);
    expect(geo({ tipo: 'punto', punto: { lat: -120, lon: -77 } })).toBe(false);
    expect(geo({ tipo: 'vertices', vertices: [] })).toBe(false);
    expect(geo({ tipo: 'parcela_forestal', principal: [], subparcelas: [] })).toBe(true);
    const punto = (hora: string) => ({
      lat: -12,
      lon: -77,
      altitud_m: null,
      precision_m: null,
      hora,
    });
    const track = (puntos: unknown[]) =>
      eventoSchema.safeParse({
        ...base,
        tipo: 'track_registrado',
        entidad: { tipo: 'track', id: ID },
        payload: { track_id: ID, ejecucion_id: ID, unidad_id: null, puntos },
      }).success;
    expect(track([punto('2026-12-05T06:00:00Z')])).toBe(false);
    expect(track([punto('2026-12-05T06:05:00Z'), punto('2026-12-05T06:00:00Z')])).toBe(false);
  });

  it('una unidad no termina antes de empezar y sus claves de datos son de formulario', () => {
    expect(
      eventoSchema.safeParse({
        ...unidad,
        payload: { ...unidad.payload, fin: '2026-12-05T06:00:00-05:00' },
      }).success,
    ).toBe(false);
    expect(
      eventoSchema.safeParse({
        ...unidad,
        payload: { ...unidad.payload, datos: { 'Mal Clave': 1 } },
      }).success,
    ).toBe(false);
    expect(
      eventoSchema.safeParse({
        ...unidad,
        payload: { ...unidad.payload, datos: { x: { anidado: true } } },
      }).success,
    ).toBe(false);
  });

  it('RF-M11 una desviación declarada exige explicación', () => {
    const con = (desviacion: unknown) =>
      eventoSchema.safeParse({ ...cierre, payload: { ...cierre.payload, desviacion } }).success;
    expect(con({ tipo: 'parcial', explicacion: 'Crecida del río' })).toBe(true);
    expect(con({ tipo: 'parcial', explicacion: '  ' })).toBe(false);
    expect(con({ tipo: 'imposibilidad', explicacion: null })).toBe(false);
  });

  it('F-02 una foto puede ir ligada a ejecución y unidad, con tipo y orientación', () => {
    const p = {
      ...fotoCapturada.payload,
      ejecucion_id: ID,
      unidad_id: ID,
      tipo_foto: 'contexto',
      orientacion: 'N',
      candidata_reporte: true,
    };
    expect(eventoSchema.safeParse({ ...fotoCapturada, payload: p }).success).toBe(true);
    expect(
      eventoSchema.safeParse({ ...fotoCapturada, payload: { ...p, orientacion: 'NE' } }).success,
    ).toBe(false);
    expect(
      eventoSchema.safeParse({ ...fotoCapturada, payload: { ...p, tipo_foto: 'selfie' } }).success,
    ).toBe(false);
  });
});

describe('alerta registrada en campo (D02 §9 y §13, RN-36, E-07)', () => {
  const alerta = (payload: Record<string, unknown>) => ({
    ...sobre,
    tipo: 'alerta_local_generada',
    entidad: { tipo: 'alerta', id: ID },
    payload: {
      alerta_id: ID,
      brigada_id: ID,
      tipo: 'tecnica',
      categoria: null,
      titulo: 'Trampa 4 inundada',
      descripcion: null,
      estacion_id: ID,
      ejecucion_id: null,
      reserva_id: null,
      afecta_cronograma: false,
      ...payload,
    },
  });

  it('técnica sin categoría', () => {
    expect(eventoSchema.safeParse(alerta({})).success).toBe(true);
  });

  it('E-07 logística con su categoría; sin ella no pasa', () => {
    expect(
      eventoSchema.safeParse(alerta({ tipo: 'logistica', categoria: 'movilidad' })).success,
    ).toBe(true);
    expect(eventoSchema.safeParse(alerta({ tipo: 'logistica' })).success).toBe(false);
    expect(eventoSchema.safeParse(alerta({ categoria: 'viaticos' })).success).toBe(false);
  });

  it('la post-sincronización no se registra desde campo y el título es obligatorio', () => {
    expect(eventoSchema.safeParse(alerta({ tipo: 'post_sincronizacion' })).success).toBe(false);
    expect(eventoSchema.safeParse(alerta({ titulo: '  ' })).success).toBe(false);
  });
});
