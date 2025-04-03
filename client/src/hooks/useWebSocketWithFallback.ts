import { useState, useEffect, useRef, useCallback } from 'react';
import { WsMessage } from '@shared/schema';
import { apiRequest } from '@/lib/queryClient';

interface WebSocketHookOptions {
  onOpen?: (event: any) => void;
  onMessage?: (event: any) => void;
  onClose?: (event: any) => void;
  onError?: (event: any) => void;
  reconnectAttempts?: number;
  reconnectInterval?: number;
  manualReconnect?: boolean;
}

type ConnectionStatus = "connecting" | "open" | "closing" | "closed" | "reconnecting";

// This hook implements a hybrid approach with WebSockets and HTTP fallback
// to handle WebSocket issues in Replit's environment
export default function useWebSocketWithFallback(options: WebSocketHookOptions = {}) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [fallbackMode, setFallbackMode] = useState(false);
  const connectionIdRef = useRef<string | null>(null);
  const lastPollTimeRef = useRef<number>(0);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const maxReconnectAttempts = options.reconnectAttempts || 5;
  const reconnectInterval = options.reconnectInterval || 3000;
  
  // Set up WebSocket or HTTP connection
  useEffect(() => {
    const setupConnection = async () => {
      try {
        if (!fallbackMode) {
          // Try WebSocket first
          await setupWebSocket();
        } else {
          // Fall back to HTTP polling
          await setupHttpPolling();
        }
      } catch (error) {
        console.error("Error setting up connection:", error);
        setConnectionStatus("closed");
      }
    };
    
    setupConnection();
    
    return () => {
      cleanupConnection();
    };
  }, [fallbackMode]);
  
  // Reference to the current WebSocket
  const wsRef = useRef<WebSocket | null>(null);
  
  // Creating a ref for reconnection to avoid circular deps
  const reconnectFnRef = useRef<() => void>(() => {
    console.log("Reconnect function not initialized yet");
  });
  
  // Setup WebSocket connection
  const setupWebSocket = async () => {
    try {
      // Special handling for Replit environment
      const replitDomain = import.meta.env.REPLIT_DOMAIN || window.location.hostname;
      const isSecure = window.location.protocol === 'https:' || 
                      import.meta.env.NODE_ENV === 'production';
      const protocol = isSecure ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${replitDomain}/ws`;
      
      console.log("Attempting WebSocket connection to:", wsUrl);
      
      // Create WebSocket and store in ref
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      
      // Handle WebSocket events
      ws.addEventListener('open', (event) => {
        console.log("WebSocket connection opened");
        setConnectionStatus("open");
        reconnectAttemptsRef.current = 0;
        
        if (options.onOpen) {
          options.onOpen(event);
        }
      });
      
      ws.addEventListener('message', (event) => {
        if (options.onMessage) {
          try {
            const data = JSON.parse(event.data);
            options.onMessage({
              type: 'message',
              data: event.data,
              parsedData: data
            });
          } catch (error) {
            console.error("Failed to parse WebSocket message:", error);
            options.onMessage(event);
          }
        }
      });
      
      ws.addEventListener('close', (event) => {
        console.log("WebSocket connection closed:", event.code, event.reason);
        setConnectionStatus("closed");
        
        if (options.onClose) {
          options.onClose(event);
        }
        
        // Switch to fallback mode after a few attempts
        if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
          console.log("Max WebSocket reconnect attempts reached, switching to HTTP fallback");
          setFallbackMode(true);
        } else if (event.code !== 1000 && !options.manualReconnect) {
          // Try to reconnect
          reconnectAttemptsRef.current++;
          setConnectionStatus("reconnecting");
          
          setTimeout(() => {
            setupWebSocket();
          }, reconnectInterval);
        }
      });
      
      ws.addEventListener('error', (event) => {
        console.error("WebSocket error:", event);
        
        if (options.onError) {
          options.onError(event);
        }
      });
      
      return ws;
    } catch (error) {
      console.error("Error setting up WebSocket:", error);
      
      if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
        console.log("Max WebSocket reconnect attempts reached, switching to HTTP fallback");
        setFallbackMode(true);
      } else {
        reconnectAttemptsRef.current++;
        setConnectionStatus("reconnecting");
        
        setTimeout(() => {
          setupWebSocket();
        }, reconnectInterval);
      }
      
      return null;
    }
  };
  
  // Setup HTTP polling fallback
  const setupHttpPolling = async () => {
    try {
      console.log("Setting up HTTP polling fallback");
      
      // Get a connection ID
      const response = await apiRequest('POST', '/api/ws/connect');
      
      if (!response.ok) {
        throw new Error("Failed to establish HTTP connection");
      }
      
      const data = await response.json();
      connectionIdRef.current = data.connectionId;
      console.log("Established HTTP fallback connection:", connectionIdRef.current);
      
      // Set connection status to open
      setConnectionStatus("open");
      
      // Simulate an open event
      if (options.onOpen) {
        options.onOpen({
          type: 'open',
          target: { url: '/api/ws/connect' }
        });
      }
      
      // Start polling for messages
      lastPollTimeRef.current = Date.now();
      startPolling();
      
      return connectionIdRef.current;
    } catch (error) {
      console.error("Error setting up HTTP polling:", error);
      setConnectionStatus("closed");
      
      if (options.onError) {
        options.onError({
          type: 'error',
          error,
          message: "Failed to establish HTTP connection"
        });
      }
      
      return null;
    }
  };
  
  // Start polling for messages
  const startPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }
    
    pollIntervalRef.current = setInterval(async () => {
      try {
        if (!connectionIdRef.current) return;
        
        const response = await apiRequest('GET', `/api/ws/poll?connectionId=${connectionIdRef.current}&since=${lastPollTimeRef.current}`);
        
        if (response.ok) {
          const currentTime = Date.now();
          const data = await response.json();
          lastPollTimeRef.current = currentTime;
          
          if (data.messages && data.messages.length > 0) {
            // Process each message
            for (const message of data.messages) {
              if (options.onMessage) {
                options.onMessage({
                  type: 'message',
                  data: JSON.stringify(message),
                  parsedData: message
                });
              }
            }
          }
        } else {
          console.error("Failed to poll for messages:", response.status);
        }
      } catch (error) {
        console.error("Error polling for messages:", error);
        
        if (options.onError) {
          options.onError({
            type: 'error',
            error,
            message: "Failed to poll for messages"
          });
        }
      }
    }, 2000); // Poll every 2 seconds
    
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  };
  
  // Clean up connection
  const cleanupConnection = () => {
    // Stop polling
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    
    // Close WebSocket connection
    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
      try {
        wsRef.current.close(1000, "Normal closure");
      } catch (error) {
        console.error("Error closing WebSocket:", error);
      }
      wsRef.current = null;
    }
    
    // Disconnect HTTP connection
    if (connectionIdRef.current && fallbackMode) {
      apiRequest('POST', '/api/ws/disconnect', { connectionId: connectionIdRef.current })
      .catch(error => {
        console.error("Error disconnecting HTTP connection:", error);
      });
    }
    
    connectionIdRef.current = null;
  };
  
  // Send message
  const sendMessage = useCallback(async (message: WsMessage) => {
    try {
      if (fallbackMode) {
        // Send via HTTP
        if (!connectionIdRef.current) {
          console.error("Cannot send message, no connection ID");
          return false;
        }
        
        const response = await apiRequest('POST', '/api/ws/send', {
          connectionId: connectionIdRef.current,
          message
        });
        
        return response.ok;
      } else {
        // Send via WebSocket
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          console.error("Cannot send message, WebSocket is not open", 
                        wsRef.current ? `(state: ${wsRef.current.readyState})` : "(no connection)");
          
          // Attempt to reconnect if disconnected
          if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
            reconnectFnRef.current(); // Use the ref instead of the function directly
          }
          
          return false;
        }
        
        try {
          wsRef.current.send(JSON.stringify(message));
          return true;
        } catch (sendError) {
          console.error("Error sending WebSocket message:", sendError);
          return false;
        }
      }
    } catch (error) {
      console.error("Error sending message:", error);
      return false;
    }
  }, [fallbackMode, connectionIdRef.current]);
  
  // Implement the actual reconnect function
  reconnectFnRef.current = () => {
    console.log("Manual reconnection requested");
    
    // Clean up existing connection
    cleanupConnection();
    
    // Reset reconnect attempts
    reconnectAttemptsRef.current = 0;
    
    // Reset fallback mode to try WebSocket first
    setFallbackMode(false);
    
    // Update connection status
    setConnectionStatus("connecting");
  };
  
  // Public reconnect API (wrapped in useCallback for stability)
  const reconnect = useCallback(() => {
    reconnectFnRef.current();
  }, []);
  
  // Join a room (convenience method for HTTP fallback)
  const joinRoom = useCallback(async (roomId: string, username: string) => {
    if (!fallbackMode) {
      console.error("joinRoom is only available in fallback mode");
      return null;
    }
    
    if (!connectionIdRef.current) {
      console.error("Cannot join room, no connection ID");
      return null;
    }
    
    try {
      const response = await apiRequest('POST', '/api/ws/join', {
        connectionId: connectionIdRef.current,
        roomId,
        username
      });
      
      if (response.ok) {
        return await response.json();
      } else {
        console.error("Failed to join room:", response.status);
        return null;
      }
    } catch (error) {
      console.error("Error joining room:", error);
      return null;
    }
  }, [fallbackMode, connectionIdRef.current]);
  
  return {
    connectionStatus,
    sendMessage,
    reconnect,
    joinRoom,
    fallbackMode,
    switchToFallback: () => setFallbackMode(true),
    switchToWebSocket: () => setFallbackMode(false),
    ws: wsRef.current,
    connectionId: fallbackMode ? connectionIdRef.current : null,
  };
}