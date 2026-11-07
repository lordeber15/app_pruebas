import type { Campo as CampoD01 } from '@campo/core';
import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { fechaLocal } from './campo.ts';
import { Boton, C, e, Segmentado, T } from './ui.tsx';
import { formatoCoordenada, formatoPrecision, leerPosicion } from './ubicacion.ts';

/**
 * Campos de D01 («Campos mínimos a capturar») generados desde la configuración del método:
 * nunca se programan a mano por método. Los textos se guardan al terminar de escribir.
 */
type Valor = string | number | boolean | null | { lat: number; lon: number };

const aTexto = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v).replace('.', ',') : '';

const etiquetaDe = (c: CampoD01) =>
  `${c.etiqueta.charAt(0).toUpperCase()}${c.etiqueta.slice(1)}${c.requerido ? '' : ' (opcional)'}`;

const Entrada = ({
  campo,
  valor,
  alGuardar,
  teclado,
  accion,
}: {
  campo: CampoD01;
  valor: unknown;
  alGuardar: (v: Valor) => void;
  teclado: 'default' | 'number-pad' | 'decimal-pad';
  accion?: { texto: string; valor: () => string };
}) => {
  const [texto, setTexto] = useState(aTexto(valor));
  useEffect(() => setTexto(aTexto(valor)), [valor]);
  const guardar = (t: string) => {
    const limpio = t.trim();
    if (limpio === '') {
      alGuardar(null);
      return;
    }
    if (teclado === 'default') {
      alGuardar(limpio);
      return;
    }
    const n = Number(limpio.replace(',', '.'));
    alGuardar(Number.isFinite(n) ? (teclado === 'number-pad' ? Math.trunc(n) : n) : null);
  };
  const vacio = campo.requerido && texto.trim() === '';
  return (
    <View style={{ gap: 6 }}>
      <Text style={e.etiqueta}>{etiquetaDe(campo)}</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput
          accessibilityLabel={campo.etiqueta}
          value={texto}
          onChangeText={setTexto}
          onEndEditing={() => guardar(texto)}
          keyboardType={teclado}
          placeholder={campo.ayuda}
          placeholderTextColor={C.suave}
          multiline={teclado === 'default' && campo.tipo === 'texto'}
          style={[
            e.entrada,
            { flex: 1, borderColor: vacio ? C.ocre : C.linea, paddingVertical: 12 },
          ]}
        />
        {accion === undefined ? null : (
          <Boton
            variante="secundario"
            texto={accion.texto}
            alPresionar={() => {
              const v = accion.valor();
              setTexto(v);
              guardar(v);
            }}
          />
        )}
      </View>
      {campo.ayuda === undefined ? null : <Text style={e.ayuda}>{campo.ayuda}</Text>}
    </View>
  );
};

const ahoraHHMM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const CampoPunto = ({
  campo,
  valor,
  alGuardar,
}: {
  campo: CampoD01;
  valor: unknown;
  alGuardar: (v: Valor) => void;
}) => {
  const [leyendo, setLeyendo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const p =
    typeof valor === 'object' && valor !== null && 'lat' in valor
      ? (valor as { lat: number; lon: number })
      : null;
  return (
    <View style={{ gap: 6 }}>
      <Text style={e.etiqueta}>{etiquetaDe(campo)}</Text>
      {p === null ? null : <Text style={T.dato}>{formatoCoordenada(p.lat, p.lon)}</Text>}
      {aviso === null ? null : <Text style={T.suave}>{aviso}</Text>}
      <Boton
        variante="secundario"
        ocupado={leyendo}
        texto={p === null ? 'Tomar coordenada' : 'Volver a tomar'}
        alPresionar={() => {
          setLeyendo(true);
          setAviso(null);
          void leerPosicion()
            .then((l) => {
              if (l === null) {
                setAviso('Sin señal GPS todavía. Intente al aire libre.');
                return;
              }
              setAviso(formatoPrecision(l.precision_m));
              alGuardar({ lat: l.lat, lon: l.lon });
            })
            .finally(() => setLeyendo(false));
        }}
      />
    </View>
  );
};

export const CampoFormulario = ({
  campo,
  valor,
  alGuardar,
}: {
  campo: CampoD01;
  valor: unknown;
  alGuardar: (v: Valor) => void;
}) => {
  switch (campo.tipo) {
    case 'texto':
      return <Entrada campo={campo} valor={valor} alGuardar={alGuardar} teclado="default" />;
    case 'entero':
      return <Entrada campo={campo} valor={valor} alGuardar={alGuardar} teclado="number-pad" />;
    case 'decimal':
      return <Entrada campo={campo} valor={valor} alGuardar={alGuardar} teclado="decimal-pad" />;
    case 'hora':
      return (
        <Entrada
          campo={campo}
          valor={valor}
          alGuardar={alGuardar}
          teclado="default"
          accion={{ texto: 'Ahora', valor: ahoraHHMM }}
        />
      );
    case 'fecha':
      return (
        <Entrada
          campo={campo}
          valor={valor}
          alGuardar={alGuardar}
          teclado="default"
          accion={{ texto: 'Hoy', valor: () => fechaLocal() }}
        />
      );
    case 'booleano':
      return (
        <Segmentado
          etiqueta={etiquetaDe(campo)}
          opciones={[
            { valor: 'si', texto: 'Sí' },
            { valor: 'no', texto: 'No' },
          ]}
          valor={valor === true ? 'si' : valor === false ? 'no' : null}
          alCambiar={(v) => alGuardar(v === 'si')}
        />
      );
    case 'opcion':
      return campo.opciones === undefined ? (
        <Entrada campo={campo} valor={valor} alGuardar={alGuardar} teclado="default" />
      ) : (
        <Segmentado
          etiqueta={etiquetaDe(campo)}
          opciones={campo.opciones.map((o) => ({ valor: o, texto: o }))}
          valor={typeof valor === 'string' ? valor : null}
          alCambiar={alGuardar}
        />
      );
    case 'punto':
      return <CampoPunto campo={campo} valor={valor} alGuardar={alGuardar} />;
  }
};

/** Formulario completo; `alCambiar` recibe todos los datos con el campo actualizado. */
export const Formulario = ({
  campos,
  datos,
  alCambiar,
}: {
  campos: readonly CampoD01[];
  datos: Record<string, unknown>;
  alCambiar: (datos: Record<string, unknown>) => void;
}) => (
  <View style={{ gap: 16 }}>
    {campos.map((c) => (
      <CampoFormulario
        key={c.clave}
        campo={c}
        valor={datos[c.clave]}
        alGuardar={(v) => alCambiar({ ...datos, [c.clave]: v })}
      />
    ))}
  </View>
);
