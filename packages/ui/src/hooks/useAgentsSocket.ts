'use client';
import { useEffect, useRef, useState, useCallback } from 'react';

export interface WSMessage {
  type: string;
  payload: unknown;
  timestamp: string;
}

export function useAgentsSocket(serverUrl = 'ws://localhost:3000') {
  const [messages, setMessages] = useState<WSMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const ws = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    try {
      const socket = new WebSocket(serverUrl);
      ws.current = socket;

      socket.onopen = () => setConnected(true);
      socket.onclose = () => {
        setConnected(false);
        reconnectTimer.current = setTimeout(connect, 3000);
      };
      socket.onerror = () => socket.close();
      socket.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data) as WSMessage;
          setMessages(prev => [...prev.slice(-99), msg]);
        } catch {}
      };
    } catch {}
  }, [serverUrl]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      ws.current?.close();
    };
  }, [connect]);

  return { connected, messages };
}
