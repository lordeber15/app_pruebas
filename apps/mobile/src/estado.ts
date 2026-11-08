import NetInfo, { NetInfoStateType } from '@react-native-community/netinfo';
import { create } from 'zustand';
import { consultar } from './bd.ts';

/**
 * Estado visible en todas las pantallas: conexión y pendientes por enviar (CLAUDE.md, Móvil).
 * `version` sube con cada cambio local para que las pantallas vuelvan a leer la base.
 */
interface EstadoApp {
  conectado: boolean;
  wifi: boolean;
  eventosPendientes: number;
  archivosPendientes: number;
  sincronizando: boolean;
  ultimoError: string | null;
  ultimaSync: string | null;
  version: number;
  /** El PIN se pidió en esta apertura de la app (solo en memoria). */
  desbloqueado: boolean;
}

export const useApp = create<EstadoApp>(() => ({
  conectado: false,
  wifi: false,
  eventosPendientes: 0,
  archivosPendientes: 0,
  sincronizando: false,
  ultimoError: null,
  ultimaSync: null,
  version: 0,
  desbloqueado: false,
}));

export const actualizarPendientes = async (): Promise<void> => {
  const [e] = await consultar<{ n: number }>(
    "SELECT count(*) AS n FROM outbox WHERE estado = 'pendiente'",
  );
  const [a] = await consultar<{ n: number }>(
    "SELECT count(*) AS n FROM archivo_local WHERE estado NOT IN ('verificado', 'anterior')",
  );
  useApp.setState({ eventosPendientes: e?.n ?? 0, archivosPendientes: a?.n ?? 0 });
};

export const avisarCambio = (): void => {
  useApp.setState((s) => ({ version: s.version + 1 }));
  void actualizarPendientes();
};

let escuchando = false;
export const escucharRed = (alConectar: () => void): void => {
  if (escuchando) return;
  escuchando = true;
  NetInfo.addEventListener((s) => {
    const conectado = s.isConnected === true && s.isInternetReachable !== false;
    const antes = useApp.getState().conectado;
    useApp.setState({
      conectado,
      wifi: s.type === NetInfoStateType.wifi && !s.details.isConnectionExpensive,
    });
    if (conectado && !antes) alConectar();
  });
};
