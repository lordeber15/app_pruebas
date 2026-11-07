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

/** Paleta de la web (cuaderno de campo), con contraste alto para leer a pleno sol. */
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
