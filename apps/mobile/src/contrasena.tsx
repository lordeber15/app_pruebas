import { CONTRASENA_MAX, cumpleContrasena, REQUISITOS_CONTRASENA } from '@campo/core';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { cambiarContrasena, ErrorServidor } from './sesion.ts';
import { Aviso, Boton, C, Campo, T } from './ui.tsx';

/** Requisito con su marca dibujada (lleno = cumple, vacío = falta) y su texto. */
const Requisito = ({ ok, texto }: { ok: boolean; texto: string }) => (
  <View
    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 28 }}
    accessible
    accessibilityLabel={`${texto}: ${ok ? 'cumple' : 'falta'}`}
  >
    <View
      style={{
        width: 16,
        height: 16,
        borderRadius: 8,
        borderWidth: 2,
        borderColor: ok ? C.liquen : C.suave,
        backgroundColor: ok ? C.liquen : 'transparent',
      }}
    />
    <Text style={[T.cuerpo, { color: ok ? C.tinta : C.suave }]}>{texto}</Text>
  </View>
);

/**
 * Formulario de cambio de contraseña: en el primer ingreso la actual es la temporal y ya se
 * conoce (no se vuelve a pedir).
 */
export const FormularioContrasena = ({
  actualConocida,
  alTerminar,
}: {
  actualConocida?: string;
  alTerminar: () => void | Promise<void>;
}) => {
  const [actual, setActual] = useState(actualConocida ?? '');
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const coincide = nueva !== '' && nueva === repetida;
  const valida = cumpleContrasena(nueva) && coincide && actual !== '' && nueva !== actual;

  const guardar = async () => {
    setError(null);
    setOcupado(true);
    try {
      await cambiarContrasena(actual, nueva);
      await alTerminar();
    } catch (err) {
      setError(
        err instanceof ErrorServidor ? err.message : 'No se pudo cambiar. Intente de nuevo.',
      );
    } finally {
      setOcupado(false);
    }
  };

  return (
    <View style={{ gap: 16 }}>
      {actualConocida === undefined ? (
        <Campo
          etiqueta="Contraseña actual"
          value={actual}
          onChangeText={setActual}
          secureTextEntry
          autoCapitalize="none"
          maxLength={CONTRASENA_MAX}
        />
      ) : null}
      <Campo
        etiqueta="Contraseña nueva"
        value={nueva}
        onChangeText={setNueva}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={CONTRASENA_MAX}
      />
      <View style={{ gap: 2 }}>
        {REQUISITOS_CONTRASENA.map((r) => (
          <Requisito key={r.clave} ok={r.cumple(nueva)} texto={r.texto} />
        ))}
      </View>
      <Campo
        etiqueta="Repita la contraseña nueva"
        value={repetida}
        onChangeText={setRepetida}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={CONTRASENA_MAX}
      />
      {repetida !== '' && !coincide ? (
        <Aviso tipo="atencion">Las dos contraseñas no coinciden.</Aviso>
      ) : null}
      {nueva !== '' && nueva === actual ? (
        <Aviso tipo="atencion">La nueva debe ser distinta de la actual.</Aviso>
      ) : null}
      {error === null ? null : <Aviso>{error}</Aviso>}
      <Boton
        texto="Guardar contraseña"
        alPresionar={() => void guardar()}
        ocupado={ocupado}
        deshabilitado={!valida}
      />
    </View>
  );
};
