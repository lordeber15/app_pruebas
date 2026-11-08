import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { useApp } from './estado.ts';
import { sincronizar } from './sync.ts';

/** Paleta de la web (libreta de campo), con contraste alto para leer a pleno sol. */
export const C = {
  papel: '#F5F7F4',
  hoja: '#FFFFFF',
  tinta: '#18231F',
  suave: '#4A5A54',
  linea: '#C9D3CD',
  liquen: '#2E5E4E',
  liquenOscuro: '#224639',
  liquenClaro: '#E3EDE8',
  ocre: '#8A5A12',
  ocreClaro: '#F6EAD6',
  oxido: '#9B2C1F',
  oxidoClaro: '#F7E4E1',
} as const;

type Variante = 'principal' | 'secundario' | 'peligro';

export const Boton = ({
  texto,
  alPresionar,
  variante = 'principal',
  ocupado = false,
  deshabilitado = false,
}: {
  texto: string;
  alPresionar: () => void;
  variante?: Variante;
  ocupado?: boolean;
  deshabilitado?: boolean;
}) => {
  const fondo = variante === 'principal' ? C.liquen : variante === 'peligro' ? C.oxido : C.hoja;
  const color = variante === 'secundario' ? C.tinta : '#FFFFFF';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: deshabilitado || ocupado, busy: ocupado }}
      disabled={deshabilitado || ocupado}
      onPress={alPresionar}
      style={({ pressed }) => [
        e.boton,
        {
          backgroundColor: fondo,
          borderColor: variante === 'secundario' ? C.linea : fondo,
          opacity: deshabilitado ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {ocupado ? (
        <ActivityIndicator color={color} />
      ) : (
        <Text style={[e.textoBoton, { color }]}>{texto}</Text>
      )}
    </Pressable>
  );
};

export const Campo = ({
  etiqueta,
  ayuda,
  ...props
}: TextInputProps & { etiqueta: string; ayuda?: string }) => (
  <View style={{ gap: 6 }}>
    <Text style={e.etiqueta}>{etiqueta}</Text>
    <TextInput
      accessibilityLabel={etiqueta}
      placeholderTextColor={C.suave}
      style={e.entrada}
      {...props}
    />
    {ayuda === undefined ? null : <Text style={e.ayuda}>{ayuda}</Text>}
  </View>
);

export const Aviso = ({
  tipo = 'error',
  children,
}: {
  tipo?: 'error' | 'atencion' | 'ok';
  children: ReactNode;
}) => {
  const estilo =
    tipo === 'error'
      ? { bg: C.oxidoClaro, c: C.oxido }
      : tipo === 'atencion'
        ? { bg: C.ocreClaro, c: C.ocre }
        : { bg: C.liquenClaro, c: C.liquenOscuro };
  return (
    <View
      accessibilityRole="alert"
      style={[e.aviso, { backgroundColor: estilo.bg, borderColor: estilo.c }]}
    >
      <Text style={{ color: estilo.c, fontSize: 15, fontWeight: '600' }}>{children}</Text>
    </View>
  );
};

export const Titulo = ({ children }: { children: ReactNode }) => (
  <Text style={e.titulo}>{children}</Text>
);
export const Texto = ({ children, suave = false }: { children: ReactNode; suave?: boolean }) => (
  <Text style={{ fontSize: 16, color: suave ? C.suave : C.tinta, lineHeight: 22 }}>{children}</Text>
);

/**
 * Barra fija con la conexión y lo pendiente por enviar (siempre visible). La forma del indicador
 * (círculo lleno o vacío) y el texto dicen lo mismo que el color.
 */
export const BarraEstado = () => {
  const s = useApp();
  const pendientes = s.eventosPendientes + s.archivosPendientes;
  return (
    <View style={e.barra} accessibilityLiveRegion="polite">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
        <View
          style={[
            e.punto,
            s.conectado ? { backgroundColor: C.liquen } : { borderWidth: 2, borderColor: C.ocre },
          ]}
        />
        <Text style={e.textoBarra}>
          {s.conectado ? 'Con conexión' : 'Sin conexión'}
          {pendientes > 0 ? `. ${String(pendientes)} por enviar` : '. Todo enviado'}
        </Text>
      </View>
      {s.conectado && pendientes > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => void sincronizar()}
          style={e.botonBarra}
          disabled={s.sincronizando}
        >
          {s.sincronizando ? (
            <ActivityIndicator color={C.liquen} />
          ) : (
            <Text style={{ color: C.liquenOscuro, fontWeight: '700' }}>Enviar</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
};

export const e = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: C.papel },
  contenido: { padding: 16, gap: 16 },
  boton: {
    minHeight: 52,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  textoBoton: { fontSize: 17, fontWeight: '700' },
  etiqueta: { fontSize: 15, fontWeight: '700', color: C.tinta },
  entrada: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: C.linea,
    borderRadius: 8,
    backgroundColor: C.hoja,
    paddingHorizontal: 14,
    fontSize: 18,
    color: C.tinta,
  },
  ayuda: { fontSize: 13, color: C.suave },
  aviso: { borderWidth: 1, borderRadius: 8, padding: 12 },
  titulo: { fontSize: 24, fontWeight: '800', color: C.tinta },
  tarjeta: {
    backgroundColor: C.hoja,
    borderWidth: 1,
    borderColor: C.linea,
    borderRadius: 8,
    padding: 14,
    gap: 6,
  },
  barra: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    minHeight: 48,
    backgroundColor: C.hoja,
    borderBottomWidth: 1,
    borderBottomColor: C.linea,
  },
  textoBarra: { fontSize: 15, color: C.tinta, fontWeight: '600' },
  punto: { width: 12, height: 12, borderRadius: 6 },
  botonBarra: {
    minHeight: 44,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: C.liquenClaro,
  },
});

// ── Piezas del flujo de campo TOCE ───────────────────────────────────────────────────────────

/** Escala tipográfica (sp), una sola familia: la del sistema. */
export const T = StyleSheet.create({
  titular: { fontSize: 26, lineHeight: 32, fontWeight: '800', color: C.tinta },
  titulo: { fontSize: 20, lineHeight: 26, fontWeight: '800', color: C.tinta },
  subtitulo: { fontSize: 17, lineHeight: 23, fontWeight: '700', color: C.tinta },
  cuerpo: { fontSize: 16, lineHeight: 22, color: C.tinta },
  suave: { fontSize: 15, lineHeight: 21, color: C.suave },
  etiqueta: { fontSize: 13, lineHeight: 17, fontWeight: '700', color: C.suave, letterSpacing: 0.2 },
  dato: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '700',
    color: C.tinta,
    fontVariant: ['tabular-nums'],
  },
});

export type Control =
  'obligatorio' | 'advertencia' | 'informativo' | 'referencia' | 'criterio_humano';

/**
 * Marcador del tipo de control (RN-31): forma + palabra, nunca solo color.
 * Obligatorio = cuadrado lleno · Advertencia = triángulo · Referencia/criterio = círculo vacío ·
 * Informativo = raya.
 */
export const MarcaControl = ({
  control,
  tamano = 12,
}: {
  control: Control | null;
  tamano?: number;
}) => {
  if (control === null) return <View style={{ width: tamano, height: tamano }} />;
  switch (control) {
    case 'obligatorio':
      return (
        <View
          style={{ width: tamano, height: tamano, backgroundColor: C.tinta, borderRadius: 2 }}
        />
      );
    case 'advertencia':
      return (
        <View
          style={{
            width: 0,
            height: 0,
            borderLeftWidth: tamano / 2 + 1,
            borderRightWidth: tamano / 2 + 1,
            borderBottomWidth: tamano,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderBottomColor: C.ocre,
          }}
        />
      );
    case 'referencia':
    case 'criterio_humano':
      return (
        <View
          style={{
            width: tamano,
            height: tamano,
            borderRadius: tamano / 2,
            borderWidth: 2,
            borderColor: C.liquen,
          }}
        />
      );
    case 'informativo':
      return (
        <View style={{ width: tamano, height: 3, backgroundColor: C.suave, borderRadius: 2 }} />
      );
  }
};

export const NOMBRE_CONTROL: Readonly<Record<Control, string>> = {
  obligatorio: 'Obligatorio',
  advertencia: 'Advertencia',
  informativo: 'Informativo',
  referencia: 'Referencia',
  criterio_humano: 'Criterio de campo',
};

/** Etiqueta corta con borde: estado o atributo. El texto siempre dice lo mismo que el color. */
export const Etiqueta = ({
  texto,
  tono = 'neutro',
}: {
  texto: string;
  tono?: 'neutro' | 'ok' | 'atencion' | 'error' | 'tinta';
}) => {
  const t = {
    neutro: { bg: C.hoja, c: C.suave, b: C.linea },
    ok: { bg: C.liquenClaro, c: C.liquenOscuro, b: C.liquenClaro },
    atencion: { bg: C.ocreClaro, c: C.ocre, b: C.ocreClaro },
    error: { bg: C.oxidoClaro, c: C.oxido, b: C.oxidoClaro },
    tinta: { bg: C.tinta, c: C.hoja, b: C.tinta },
  }[tono];
  return (
    <View
      style={{
        backgroundColor: t.bg,
        borderColor: t.b,
        borderWidth: 1,
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 3,
        alignSelf: 'flex-start',
      }}
    >
      <Text style={{ color: t.c, fontSize: 13, fontWeight: '700' }}>{texto}</Text>
    </View>
  );
};

/** Fila tocable de lista (≥ 64 dp), con un acento a la derecha. */
export const Fila = ({
  alPresionar,
  children,
  derecha,
  etiquetaAccesible,
}: {
  alPresionar: () => void;
  children: ReactNode;
  derecha?: ReactNode;
  etiquetaAccesible?: string;
}) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={etiquetaAccesible}
    onPress={alPresionar}
    style={({ pressed }) => [
      {
        minHeight: 64,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 12,
        paddingHorizontal: 16,
        backgroundColor: pressed ? C.liquenClaro : C.hoja,
      },
    ]}
  >
    <View style={{ flex: 1, gap: 4 }}>{children}</View>
    {derecha}
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{
        width: 10,
        height: 10,
        borderTopWidth: 2,
        borderRightWidth: 2,
        borderColor: C.suave,
        transform: [{ rotate: '45deg' }],
        marginRight: 4,
      }}
    />
  </Pressable>
);

/** Grupo de filas con separadores finos, sin tarjetas anidadas. */
export const Grupo = ({
  titulo,
  nota,
  children,
}: {
  titulo?: string;
  nota?: string;
  children: ReactNode;
}) => (
  <View style={{ gap: 8 }}>
    {titulo === undefined ? null : (
      <View style={{ paddingHorizontal: 4, gap: 2 }}>
        <Text style={T.subtitulo} accessibilityRole="header">
          {titulo}
        </Text>
        {nota === undefined ? null : <Text style={T.suave}>{nota}</Text>}
      </View>
    )}
    <View
      style={{
        borderWidth: 1,
        borderColor: C.linea,
        borderRadius: 10,
        overflow: 'hidden',
        backgroundColor: C.hoja,
      }}
    >
      {children}
    </View>
  </View>
);

export const Separador = () => (
  <View style={{ height: 1, backgroundColor: C.linea, marginLeft: 16 }} />
);

/** Selector de opciones excluyentes (≥ 48 dp por opción). */
export const Segmentado = <V extends string>({
  opciones,
  valor,
  alCambiar,
  etiqueta,
}: {
  opciones: readonly { valor: V; texto: string }[];
  valor: V | null;
  alCambiar: (v: V) => void;
  etiqueta: string;
}) => (
  <View style={{ gap: 6 }}>
    <Text style={e.etiqueta}>{etiqueta}</Text>
    <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {opciones.map((o) => {
        const activo = o.valor === valor;
        return (
          <Pressable
            key={o.valor}
            accessibilityRole="radio"
            accessibilityState={{ selected: activo }}
            onPress={() => alCambiar(o.valor)}
            style={{
              minHeight: 48,
              minWidth: 64,
              paddingHorizontal: 14,
              justifyContent: 'center',
              alignItems: 'center',
              borderRadius: 8,
              borderWidth: activo ? 2 : 1,
              borderColor: activo ? C.liquenOscuro : C.linea,
              backgroundColor: activo ? C.liquenClaro : C.hoja,
            }}
          >
            <Text
              style={{
                fontSize: 16,
                fontWeight: activo ? '800' : '600',
                color: activo ? C.liquenOscuro : C.tinta,
              }}
            >
              {o.texto}
            </Text>
          </Pressable>
        );
      })}
    </View>
  </View>
);

/** Avance con texto explícito; la barra solo acompaña al número. */
export const Avance = ({
  ejecutado,
  objetivo,
  unidad,
}: {
  ejecutado: number;
  objetivo: number | null;
  unidad: string;
}) => {
  const pct = objetivo === null || objetivo <= 0 ? null : Math.min(1, ejecutado / objetivo);
  return (
    <View style={{ gap: 6 }}>
      <Text style={T.dato}>
        {objetivo === null
          ? `${String(ejecutado)} ${unidad}`
          : `${String(ejecutado)} de ${String(objetivo)} ${unidad}`}
      </Text>
      {pct === null ? null : (
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: objetivo ?? 0, now: ejecutado }}
          style={{ height: 8, borderRadius: 4, backgroundColor: C.linea, overflow: 'hidden' }}
        >
          <View
            style={{
              width: `${String(Math.round(pct * 100))}%`,
              height: 8,
              backgroundColor: pct >= 1 ? C.liquen : C.ocre,
            }}
          />
        </View>
      )}
    </View>
  );
};

/**
 * Barra de progreso simple (0–100). Sin porcentaje no se dibuja relleno: la ausencia de datos
 * no es 0 % (RN-37). El texto que la acompaña dice el valor; el color no es el único indicador.
 */
export const BarraProgreso = ({
  porcentaje,
  etiqueta,
  alto = 8,
}: {
  porcentaje: number | null;
  etiqueta: string;
  alto?: number;
}) => {
  const pct = porcentaje === null ? 0 : Math.max(0, Math.min(100, porcentaje));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={etiqueta}
      accessibilityValue={porcentaje === null ? undefined : { min: 0, max: 100, now: pct }}
      style={{
        height: alto,
        borderRadius: alto / 2,
        backgroundColor: C.linea,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          width: `${String(Math.round(pct))}%`,
          height: alto,
          backgroundColor: pct >= 100 ? C.liquen : C.ocre,
        }}
      />
    </View>
  );
};

/** Barra inferior fija para la acción principal de la pantalla. */
export const AccionInferior = ({ children, abajo }: { children: ReactNode; abajo: number }) => (
  <View
    style={{
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: abajo + 12,
      backgroundColor: C.hoja,
      borderTopWidth: 1,
      borderTopColor: C.linea,
      gap: 8,
    }}
  >
    {children}
  </View>
);

const SIGLAS = ['VES', 'TBF', 'ABS', 'ZA/EF', 'ZA', 'EF', 'DAP', 'UV', 'N-S-E-O'];
/** Los nombres de D01 vienen en mayúsculas: se presentan en tipo oración, conservando siglas. */
export const tipoOracion = (texto: string): string => {
  const bajo = texto.toLocaleLowerCase('es');
  const conSiglas = bajo.replace(/[\p{L}/-]+/gu, (p) => {
    const s = SIGLAS.find((x) => x.toLocaleLowerCase('es') === p);
    return s ?? p;
  });
  return conSiglas.charAt(0).toLocaleUpperCase('es') + conSiglas.slice(1);
};
