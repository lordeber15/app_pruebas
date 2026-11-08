import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { abrirBd } from '../src/bd.ts';
import { actualizarPendientes, escucharRed, useApp } from '../src/estado.ts';
import { sincronizar } from '../src/sync.ts';
import { C } from '../src/ui.tsx';

const CADA_DOS_MINUTOS = 2 * 60 * 1000;

export default function Raiz() {
  useEffect(() => {
    void abrirBd().then(actualizarPendientes);
    // Al volver la conexión se envía lo pendiente; mientras hay red, cada dos minutos.
    escucharRed(() => void sincronizar());
    const t = setInterval(() => {
      if (useApp.getState().conectado) void sincronizar();
    }, CADA_DOS_MINUTOS);
    return () => clearInterval(t);
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: C.hoja },
          headerTintColor: C.tinta,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: C.papel },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Campo' }} />
        <Stack.Screen name="servidor" options={{ title: 'Servidor' }} />
        <Stack.Screen name="contrasena" options={{ title: 'Contraseña' }} />
        <Stack.Screen name="entrar" options={{ title: 'Ingresar', headerBackVisible: false }} />
        <Stack.Screen
          name="desbloquear"
          options={{ title: 'Desbloquear', headerBackVisible: false }}
        />
        <Stack.Screen name="estacion/[id]" options={{ title: 'Estación' }} />
        <Stack.Screen name="metodo" options={{ title: 'Método' }} />
        <Stack.Screen name="ejecucion/[id]" options={{ title: 'Ejecución' }} />
        <Stack.Screen name="unidad/[id]" options={{ title: 'Unidad' }} />
        <Stack.Screen name="cierre/[id]" options={{ title: 'Revisar y cerrar' }} />
        <Stack.Screen
          name="camara"
          options={{ title: 'Cámara', presentation: 'fullScreenModal', headerShown: false }}
        />
      </Stack>
    </SafeAreaProvider>
  );
}
