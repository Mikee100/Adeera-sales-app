import { io, Socket } from 'socket.io-client';
import { logger } from '../shared/logger';

export interface RestaurantOrderEvent {
  type: 'created' | 'statusChanged' | 'itemsAdded';
  orderId: string;
  status?: string;
  order?: unknown;
}

type OrderEventHandler = (event: RestaurantOrderEvent) => void;

let socket: Socket | null = null;

export function connectRealtimeSocket(params: {
  baseUrl: string;
  token: string;
  tenantId: string;
  branchId?: string | null;
  onOrderEvent: OrderEventHandler;
}): void {
  disconnectRealtimeSocket();

  socket = io(params.baseUrl, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 15000,
    auth: {
      token: params.token,
      tenantId: params.tenantId,
      branchId: params.branchId || undefined,
    },
  });

  socket.on('connect', () => {
    logger.info('Realtime socket connected', { component: 'realtime' });
  });

  socket.on('disconnect', (reason) => {
    logger.warn('Realtime socket disconnected', { component: 'realtime', reason });
  });

  socket.on('connect_error', (error: Error) => {
    logger.warn('Realtime socket connect error', {
      component: 'realtime',
      errorMessage: error.message,
    });
  });

  socket.on('restaurantOrderEvent', (event: RestaurantOrderEvent) => {
    params.onOrderEvent(event);
  });
}

export function disconnectRealtimeSocket(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

export function isRealtimeSocketConnected(): boolean {
  return !!socket?.connected;
}
