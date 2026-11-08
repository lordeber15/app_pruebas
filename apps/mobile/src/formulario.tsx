import type { Campo as CampoD01 } from '@campo/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { fechaLocal } from './campo.ts';
import { Boton, C, e, Segmentado, T } from './ui.tsx';
import { formatoCoordenada, formatoPrecision, leerPosicion } from './ubicacion.ts';

/**
 * Campos de D01 («Campos mínimos a capturar») generados desde la configuración del método:
 * nunca se programan a mano por método. Los textos se guardan mientras se escribe (con una
 * pausa corta), al salir del campo y al desmontarse la pantalla; antes de una acción que use
 * los datos (terminar, cerrar, agregar fila) la pantalla llama a `guardarPendientes()`.
 */
export type Valor = string | number | boolean | null | { lat: number; lon: number };

const PAUSA_MS = 400;

/** Textos escritos que aún no se entregaron a la pantalla (uno por campo con cambios). */
const pendientes = new Set<() => void>();

/**
 * Entrega ya lo escrito en cualquier campo, de forma síncrona: tras llamarla, los `alGuardar`
 * de los campos con cambios ya se ejecutaron (la pantalla los encola antes de su acción).
 */
export const guardarPendientes = (): void => {
  for (const f of [...pendientes]) f();
};

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
  // Último valor que este campo entregó o recibió: solo un cambio externo reemplaza el texto,
  // nunca el eco de lo que se acaba de guardar (así no se borra lo que se está escribiendo).
  const conocido = useRef<unknown>(valor);
  const sucio = useRef<string | null>(null);
  const reloj = useRef<ReturnType<typeof setTimeout> | null>(null);
  const guardarRef = useRef(alGuardar);
  guardarRef.current = alGuardar;

  const convertir = useCallback(
    (t: string): Valor => {
      const limpio = t.trim();
      if (limpio === '') return null;
      if (teclado === 'default') return limpio;
      const n = Number(limpio.replace(',', '.'));
      return Number.isFinite(n) ? (teclado === 'number-pad' ? Math.trunc(n) : n) : null;
    },
    [teclado],
  );

  const vaciar = useCallback(() => {
    if (reloj.current !== null) clearTimeout(reloj.current);
    reloj.current = null;
    const t = sucio.current;
    if (t === null) return;
    sucio.current = null;
    pendientes.delete(vaciar);
    const v = convertir(t);
    conocido.current = v;
    guardarRef.current(v);
  }, [convertir]);

  useEffect(() => {
    if (sucio.current !== null) return;
    if (Object.is(valor, conocido.current)) return;
    if ((valor === undefined || valor === null) && conocido.current === null) return;
    conocido.current = valor;
    setTexto(aTexto(valor));
  }, [valor]);

  // Al salir de la pantalla (atrás, navegar) se guarda lo último escrito.
  useEffect(() => vaciar, [vaciar]);

  const escribir = (t: string) => {
    setTexto(t);
    sucio.current = t;
    pendientes.add(vaciar);
    if (reloj.current !== null) clearTimeout(reloj.current);
    reloj.current = setTimeout(vaciar, PAUSA_MS);
  };

  const vacio = campo.requerido && texto.trim() === '';
  return (
    <View style={{ gap: 6 }}>
      <Text style={e.etiqueta}>{etiquetaDe(campo)}</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput
          accessibilityLabel={campo.etiqueta}
          value={texto}
          onChangeText={escribir}
          onBlur={vaciar}
          onEndEditing={vaciar}
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
              escribir(accion.valor());
              vaciar();
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

/**
 * Formulario completo; `alCambiar` recibe **solo el campo que cambió**, para que la pantalla lo
 * combine con lo vigente (nunca con una copia vieja de todos los datos).
 */
export const Formulario = ({
  campos,
  datos,
  alCambiar,
}: {
  campos: readonly CampoD01[];
  datos: Record<string, unknown>;
  alCambiar: (clave: string, valor: Valor) => void;
}) => (
  <View style={{ gap: 16 }}>
    {campos.map((c) => (
      <CampoFormulario
        key={c.clave}
        campo={c}
        valor={datos[c.clave]}
        alGuardar={(v) => alCambiar(c.clave, v)}
      />
    ))}
  </View>
);
