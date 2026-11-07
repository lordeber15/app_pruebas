import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { borrarTodo, consultar } from '../src/bd.ts';
import { useApp } from '../src/estado.ts';
import { verificarPin } from '../src/pin.ts';
import { olvidarSesion } from '../src/sesion.ts';
import { sincronizar } from '../src/sync.ts';
import { Aviso, Boton, Campo, e, Texto, Titulo } from '../src/ui.tsx';

/** Apertura sin conexión con el PIN (CA-01). */
export default function Desbloquear() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  const abrir = async () => {
    if (await verificarPin(pin)) {
      useApp.setState({ desbloqueado: true });
      void sincronizar();
      router.replace('/');
    } else {
      setError('PIN incorrecto.');
      setPin('');
    }
  };

  /** Olvidó el PIN: vuelve a ingresar con su contraseña; solo se borra si no hay pendientes. */
  const olvide = async () => {
    const [p] = await consultar<{ n: number }>(
      "SELECT count(*) AS n FROM outbox WHERE estado = 'pendiente'",
    );
    if ((p?.n ?? 0) > 0) {
      setError(
        'Tiene datos sin enviar. Conéctese y pida al administrador una nueva contraseña antes de reiniciar el celular.',
      );
      return;
    }
    await olvidarSesion();
    await borrarTodo();
    router.replace('/entrar');
  };

  return (
    <ScrollView
      style={e.pantalla}
      contentContainerStyle={e.contenido}
      keyboardShouldPersistTaps="handled"
    >
      <Titulo>Ingrese su PIN</Titulo>
      <Texto suave>Funciona sin señal.</Texto>
      <Campo
        etiqueta="PIN"
        value={pin}
        onChangeText={setPin}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
        autoFocus
        onSubmitEditing={() => void abrir()}
      />
      {error === null ? null : <Aviso>{error}</Aviso>}
      <Boton texto="Abrir" alPresionar={() => void abrir()} deshabilitado={pin.length !== 6} />
      <Boton texto="Olvidé mi PIN" variante="secundario" alPresionar={() => void olvide()} />
    </ScrollView>
  );
}
