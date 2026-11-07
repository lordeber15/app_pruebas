import { describe, expect, it } from 'vitest';
import {
  configuracionMetodoSchema,
  contarPorClase,
  semillaD01Schema,
  type ConfiguracionMetodo,
} from './metodo.ts';

const base: ConfiguracionMetodo = {
  codigo: 'aves.puntos_conteo',
  nombre: 'PUNTOS DE CONTEO',
  especialidad: 'aves',
  clase: 'condicional',
  aplicacion: {
    texto: 'Estaciones de costa y sierra, excepto lagos, lagunas y cochas.',
    condicion: {
      tipo: 'region_excepto_uv',
      regiones: ['COSTA', 'SIERRA'],
      uv_excluida_contiene: ['lacustre'],
    },
  },
  unidad: { tipo: 'punto', tipos_adicionales: [], texto: 'Punto de conteo de 10 minutos.' },
  esfuerzo: {
    estandar: { cantidad: 10, unidad: 'puntos de conteo', texto: '10 puntos de conteo.' },
    za_ef: { cantidad: 20, texto: '20 puntos de conteo.' },
  },
  horario: { ventanas: [{ inicio: '06:00', fin: '10:00' }], texto: '06:00–10:00' },
  geometria: {
    tipo: 'punto',
    texto: 'Punto georreferenciado por punto de conteo',
    vinculo_metodo: null,
    detalle: null,
  },
  track: false,
  fotos: {
    contexto: {
      cantidad_por_unidad: 4,
      cardinales: true,
      reutiliza_metodo: null,
      texto: '4 panorámicas N-S-E-O',
    },
    metodologicas: { minimo: 2, texto: 'Mínimo 2 por estación/método' },
  },
  campos_ejecucion: [],
  campos: [{ clave: 'habitat', etiqueta: 'Hábitat predominante', tipo: 'texto', requerido: true }],
  registros: null,
  validaciones: [
    {
      tipo: 'duracion_unidad_min',
      minutos: 10,
      minutos_za_ef: null,
      tipo_control: 'obligatorio',
      texto: 'Validar 10 min',
    },
  ],
  vinculo: null,
  fuente: { estado: 'CERRADO', origen: 'Metodología fuente', pendiente: 'Confirmar estaciones' },
};

describe('configuración por método (D01)', () => {
  it('acepta un método bien formado', () => {
    expect(configuracionMetodoSchema.safeParse(base).success).toBe(true);
  });

  it('un CONDICIONAL sin condición se rechaza: nunca se asume por inferencia', () => {
    const r = semillaD01Schema.safeParse({
      fuente: 'x',
      version: 'x',
      especialidades: [{ codigo: 'aves', nombre: 'AVES', es_fauna: true, orden: 1 }],
      metodos: [{ ...base, aplicacion: { texto: 't', condicion: null } }],
    });
    expect(r.success).toBe(false);
  });

  it('un vínculo a un método desconocido se rechaza', () => {
    const r = semillaD01Schema.safeParse({
      fuente: 'x',
      version: 'x',
      especialidades: [{ codigo: 'aves', nombre: 'AVES', es_fauna: true, orden: 1 }],
      metodos: [
        {
          ...base,
          geometria: { ...base.geometria, tipo: 'vinculada', vinculo_metodo: 'aves.nada' },
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('RN-31: cada validación lleva su tipo de control y un informativo nunca es obligatorio', () => {
    const r = configuracionMetodoSchema.safeParse({
      ...base,
      validaciones: [{ tipo: 'mensaje', tipo_control: 'obligatorio', texto: 'x' }],
    });
    expect(r.success).toBe(false);
  });

  it('cuenta por clase', () => {
    expect(contarPorClase([{ clase: 'todas' }, { clase: 'todas' }, { clase: 'evento' }])).toEqual({
      todas: 2,
      condicional: 0,
      evento: 1,
      atributo: 0,
      transversal: 0,
    });
  });
});
