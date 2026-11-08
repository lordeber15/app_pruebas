import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { FormularioContrasena } from '../src/contrasena.tsx';
import { useApp } from '../src/estado.ts';
import { Aviso, Boton, e, Texto, Titulo } from '../src/ui.tsx';

/** Cambiar la propia contraseña cuando se quiera. Necesita conexión. */
export default function Contrasena() {
  const conectado = useApp((s) => s.conectado);
  const [listo, setListo] = useState(false);
  return (
    <ScrollView
      style={e.pantalla}
      contentContainerStyle={e.contenido}
      keyboardShouldPersistTaps="handled"
    >
      <Titulo>Cambiar contraseña</Titulo>
      <Texto suave>Al cambiarla se cierran sus otras sesiones. Su PIN no cambia.</Texto>
      {listo ? (
        <>
          <Aviso tipo="ok">Su contraseña se cambió.</Aviso>
          <Boton texto="Volver" alPresionar={() => router.back()} />
        </>
      ) : conectado ? (
        <FormularioContrasena alTerminar={() => setListo(true)} />
      ) : (
        <Aviso tipo="atencion">Sin conexión. Cambie su contraseña cuando tenga señal.</Aviso>
      )}
    </ScrollView>
  );
}
