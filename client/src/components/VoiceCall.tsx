import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { 
  Phone, PhoneOff, Mic, MicOff, User, Clock,
  ChevronLeft, Move, Volume2, Users
} from "lucide-react";
import { WsMessageType, WsMessage } from '@shared/schema';
import { formatDistance } from 'date-fns';

interface VoiceCallProps {
  roomId: string;
  nickname: string;
  sendMessage: (message: WsMessage) => void;
  onClose: () => void;
  connectionStatus: string;
  lastVoiceCallMessage?: WsMessage | null;
  activeCallInfo?: {
    isCallActive: boolean;
    participants: string[];
    initiatedBy: string;
    startTime?: Date;
  };
}

const VoiceCall: React.FC<VoiceCallProps> = ({
  roomId,
  nickname,
  sendMessage,
  onClose,
  connectionStatus,
  lastVoiceCallMessage,
  activeCallInfo
}) => {
  const [calling, setCalling] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  
  const localAudioRef = useRef<HTMLAudioElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  
  // Set up
  useEffect(() => {
    // Configure peer connection options
    const configuration: RTCConfiguration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ]
    };
    
    // Create peer connection
    peerConnection.current = new RTCPeerConnection(configuration);
    
    // Set up event handlers
    if (peerConnection.current) {
      peerConnection.current.onicecandidate = handleICECandidate;
      peerConnection.current.ontrack = handleTrack;
      peerConnection.current.oniceconnectionstatechange = () => {
        console.log("ICE Connection State:", peerConnection.current?.iceConnectionState);
        if (peerConnection.current?.iceConnectionState === 'disconnected' || 
            peerConnection.current?.iceConnectionState === 'failed' ||
            peerConnection.current?.iceConnectionState === 'closed') {
          handleHangUp();
        }
      };
    }
    
    // Clean up
    return () => {
      stopLocalStream();
      if (peerConnection.current) {
        peerConnection.current.close();
        peerConnection.current = null;
      }
    };
  }, []);
  
  // Handle incoming WebRTC signaling messages
  useEffect(() => {
    // If disconnected, reset call state
    if (connectionStatus === 'closed' && (calling || inCall)) {
      handleHangUp();
    }
  }, [connectionStatus, calling, inCall]);
  
  // Process lastVoiceCallMessage whenever it changes
  useEffect(() => {
    if (lastVoiceCallMessage) {
      console.log("Processing voice call message in VoiceCall component:", lastVoiceCallMessage.type);
      handleVoiceCallMessage(lastVoiceCallMessage);
    }
  }, [lastVoiceCallMessage]);
  
  // Reset peer connection when call UI is opened but not in a call
  useEffect(() => {
    // Create a new peer connection if we're not in a call but the UI is open
    if (!inCall && !calling && peerConnection.current) {
      console.log("Setting up fresh peer connection for potential new call");
      
      // Create new peer connection for potential new calls
      const configuration: RTCConfiguration = {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' },
          { urls: 'stun:stun4.l.google.com:19302' },
        ]
      };
      
      // Clean up existing connection if needed
      if (peerConnection.current.connectionState !== 'closed') {
        try {
          peerConnection.current.close();
        } catch (err) {
          console.error("Error closing previous peer connection:", err);
        }
      }
      
      // Create new connection
      peerConnection.current = new RTCPeerConnection(configuration);
      
      if (peerConnection.current) {
        peerConnection.current.onicecandidate = handleICECandidate;
        peerConnection.current.ontrack = handleTrack;
        peerConnection.current.oniceconnectionstatechange = () => {
          console.log("ICE Connection State:", peerConnection.current?.iceConnectionState);
        };
      }
    }
  }, [inCall, calling]);
  
  // Get user media with permission handling
  const getUserMedia = async () => {
    try {
      // First, check if permissions are granted
      const permissions = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      console.log("Microphone permission status:", permissions.state);
      
      // For browsers that don't support permissions API or if permission is prompt/granted
      try {
        console.log("Requesting user media (audio only)...");
        // Request audio only for voice call
        return await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: false
        });
      } catch (mediaError) {
        console.error("Error accessing media devices:", mediaError);
        throw mediaError;
      }
    } catch (error) {
      console.error("Permission check failed:", error);
      // Fallback for browsers that don't support permissions API
      try {
        console.log("Fallback: directly requesting user media (audio only)...");
        return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (fallbackError) {
        console.error("Fallback getUserMedia failed:", fallbackError);
        throw fallbackError;
      }
    }
  };
  
  // Get user media and start a call or join existing call
  const startCall = async () => {
    try {
      setCalling(true);
      toast({
        title: activeCallInfo?.isCallActive ? "Joining Call" : "Starting Call",
        description: "Please allow access to your microphone when prompted.",
      });
      
      // Get user media
      console.log("Getting user media (audio only)...");
      localStream.current = await getUserMedia();
      console.log("User media obtained successfully");
      
      // Set up audio (instead of video)
      if (localAudioRef.current && localStream.current) {
        localAudioRef.current.srcObject = localStream.current;
        localAudioRef.current.muted = true; // Mute local audio to prevent feedback
      }
      
      // Add tracks to the peer connection
      if (peerConnection.current && localStream.current) {
        localStream.current.getTracks().forEach(track => {
          if (peerConnection.current && localStream.current) {
            peerConnection.current.addTrack(track, localStream.current);
          }
        });
        
        // If there's already an active call, we'll join it rather than starting a new one
        if (activeCallInfo?.isCallActive) {
          console.log("Joining existing call with participants:", activeCallInfo.participants);
          
          // Send a message requesting the call offer from someone in the call
          // The initiator will see this and re-send the offer
          sendMessage({
            type: WsMessageType.VIDEO_CALL_START,
            payload: {
              roomId,
              caller: nickname,
              joining: true // Flag to indicate we're joining an existing call
            }
          });
          
          toast({
            title: "Joining Call",
            description: `Connecting to active call with ${activeCallInfo.participants.filter(p => p !== nickname).join(', ')}...`
          });
        } else {
          // Create and send a new call offer (starting a new call)
          console.log("Creating offer for new call...");
          const offer = await peerConnection.current.createOffer();
          await peerConnection.current.setLocalDescription(offer);
          
          sendMessage({
            type: WsMessageType.VIDEO_CALL_START,
            payload: {
              sdp: peerConnection.current.localDescription,
              roomId,
              caller: nickname
            }
          });
          
          toast({
            title: "Calling",
            description: "Waiting for someone to join the call..."
          });
        }
      }
    } catch (error) {
      console.error('Error starting/joining call:', error);
      setCalling(false);
      
      // Show specific error messages based on the error type
      if (error instanceof DOMException) {
        if (error.name === 'NotAllowedError') {
          toast({
            title: "Permission Denied",
            description: "Microphone access was denied. Please allow access in your browser settings and try again.",
            variant: "destructive"
          });
        } else if (error.name === 'NotFoundError') {
          toast({
            title: "Microphone Not Found",
            description: "No microphone was found on your device.",
            variant: "destructive"
          });
        } else {
          toast({
            title: "Call Failed",
            description: `${error.name}: ${error.message}`,
            variant: "destructive"
          });
        }
      } else {
        toast({
          title: "Call Failed",
          description: "Could not access microphone. Please check permissions.",
          variant: "destructive"
        });
      }
    }
  };
  
  // Handle ICE candidates
  const handleICECandidate = (event: RTCPeerConnectionIceEvent) => {
    if (event.candidate) {
      sendMessage({
        type: WsMessageType.VIDEO_CALL_ICE,
        payload: {
          candidate: event.candidate,
          roomId,
          from: nickname
        }
      });
    }
  };
  
  // Handle incoming tracks
  const handleTrack = (event: RTCTrackEvent) => {
    if (remoteAudioRef.current && event.streams && event.streams[0]) {
      remoteAudioRef.current.srcObject = event.streams[0];
      setInCall(true);
      setCalling(false);
    }
  };
  
  // Handle answer to our offer
  const handleAnswerCall = async (answerSdp: RTCSessionDescriptionInit) => {
    if (peerConnection.current) {
      await peerConnection.current.setRemoteDescription(new RTCSessionDescription(answerSdp));
      setInCall(true);
      setCalling(false);
    }
  };
  
  // Handle incoming call
  const handleIncomingCall = async (offerSdp: RTCSessionDescriptionInit, caller: string) => {
    try {
      // Create notification
      toast({
        title: "Incoming Call",
        description: `${caller} is calling. Please allow access to your microphone.`,
      });
      
      // Get user media using our improved function
      console.log("Getting user media for incoming call (audio only)...");
      localStream.current = await getUserMedia();
      console.log("User media obtained successfully for incoming call");
      
      // Set up audio
      if (localAudioRef.current && localStream.current) {
        localAudioRef.current.srcObject = localStream.current;
        localAudioRef.current.muted = true; // Mute local audio to prevent feedback
      }
      
      // Add tracks to the peer connection
      if (peerConnection.current && localStream.current) {
        localStream.current.getTracks().forEach(track => {
          if (peerConnection.current && localStream.current) {
            peerConnection.current.addTrack(track, localStream.current);
          }
        });
        
        // Set remote description (the offer)
        console.log("Setting remote description for incoming call...");
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(offerSdp));
        
        // Create and send answer
        console.log("Creating answer for incoming call...");
        const answer = await peerConnection.current.createAnswer();
        await peerConnection.current.setLocalDescription(answer);
        
        sendMessage({
          type: WsMessageType.VIDEO_CALL_ANSWER,
          payload: {
            sdp: peerConnection.current.localDescription,
            roomId,
            answerer: nickname
          }
        });
        
        toast({
          title: "Call Connected",
          description: `You are now in a call with ${caller}`,
        });
        
        setInCall(true);
      }
    } catch (error) {
      console.error('Error handling incoming call:', error);
      
      // Show specific error messages based on the error type
      if (error instanceof DOMException) {
        if (error.name === 'NotAllowedError') {
          toast({
            title: "Permission Denied",
            description: "Microphone access was denied. The call cannot proceed.",
            variant: "destructive"
          });
        } else if (error.name === 'NotFoundError') {
          toast({
            title: "Microphone Not Found",
            description: "No microphone was found on your device.",
            variant: "destructive"
          });
        } else {
          toast({
            title: "Call Failed",
            description: `${error.name}: ${error.message}`,
            variant: "destructive"
          });
        }
      } else {
        toast({
          title: "Call Failed",
          description: "Could not access microphone. Please check your device permissions.",
          variant: "destructive"
        });
      }
      
      // Send hangup message to the caller to let them know we couldn't answer
      sendMessage({
        type: WsMessageType.VIDEO_CALL_HANGUP,
        payload: {
          roomId,
          from: nickname,
          reason: "Failed to access media devices"
        }
      });
    }
  };
  
  // Handle ICE candidate from remote peer
  const handleRemoteICECandidate = async (candidate: RTCIceCandidateInit) => {
    if (peerConnection.current) {
      await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
    }
  };
  
  // Stop local stream
  const stopLocalStream = () => {
    if (localStream.current) {
      localStream.current.getTracks().forEach(track => track.stop());
      localStream.current = null;
    }
  };
  
  // Handle hang up - only this user leaves the call
  const handleHangUp = () => {
    // Send hangup message to notify others you've left
    if (calling || inCall) {
      console.log(`User ${nickname} is leaving the call`);
      sendMessage({
        type: WsMessageType.VIDEO_CALL_HANGUP,
        payload: {
          roomId,
          from: nickname,
          // Don't indicate that the entire call should end, just that this user is leaving
          keepCallActive: true
        }
      });
    }
    
    // Reset local state
    setCalling(false);
    setInCall(false);
    
    // Stop media
    stopLocalStream();
    
    // Reset peer connection
    if (peerConnection.current) {
      peerConnection.current.getSenders().forEach(sender => {
        if (sender.track) {
          sender.track.stop();
        }
      });
      
      try {
        peerConnection.current.close();
      } catch (err) {
        console.error("Error closing peer connection:", err);
      }
      
      // Create new peer connection for future calls
      const configuration: RTCConfiguration = {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ]
      };
      
      peerConnection.current = new RTCPeerConnection(configuration);
      
      if (peerConnection.current) {
        peerConnection.current.onicecandidate = handleICECandidate;
        peerConnection.current.ontrack = handleTrack;
        peerConnection.current.oniceconnectionstatechange = () => {
          console.log("ICE Connection State:", peerConnection.current?.iceConnectionState);
        };
      }
    }
    
    // Reset audio elements
    if (localAudioRef.current) {
      localAudioRef.current.srcObject = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
  };
  
  // Handle exit from call screen
  const handleExit = () => {
    // If in a call, just hide the UI but stay connected
    if (inCall) {
      onClose();
    } else {
      // If not in an active call, hang up and close
      handleHangUp();
      onClose();
    }
  };
  
  // Toggle audio mute
  const toggleMute = () => {
    if (localStream.current) {
      const audioTracks = localStream.current.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setAudioEnabled(!audioEnabled);
    }
  };
  
  // Process voice call signaling messages
  const handleVoiceCallMessage = (message: WsMessage) => {
    console.log("Handling voice call message:", message.type);
    
    switch (message.type) {
      case WsMessageType.VIDEO_CALL_START:
        if (message.payload.sdp && message.payload.caller !== nickname) {
          handleIncomingCall(message.payload.sdp, message.payload.caller);
        }
        break;
        
      case WsMessageType.VIDEO_CALL_ANSWER:
        if (message.payload.sdp) {
          handleAnswerCall(message.payload.sdp);
        }
        break;
        
      case WsMessageType.VIDEO_CALL_ICE:
        if (message.payload.candidate && message.payload.from !== nickname) {
          handleRemoteICECandidate(message.payload.candidate);
        }
        break;
        
      case WsMessageType.VIDEO_CALL_HANGUP:
        // Only handle if this is a remote hangup (not our own)
        if (message.payload.from !== nickname) {
          toast({
            title: "Call Ended",
            description: `${message.payload.from} has left the call.`,
          });
          
          // If we're the last one in the call, close our call UI too
          if (activeCallInfo?.participants.length === 1) {
            handleHangUp();
            onClose();
          }
        }
        break;
    }
  };
  
  // Get participant list for display
  const getParticipantDisplay = () => {
    if (!activeCallInfo) return '';
    
    const otherParticipants = activeCallInfo.participants.filter(p => p !== nickname);
    if (otherParticipants.length === 0) {
      return 'No one else is in the call';
    }
    return otherParticipants.join(', ');
  };
  
  // Get call duration display
  const getCallDuration = () => {
    if (!activeCallInfo?.startTime) return '';
    
    const duration = formatDistance(new Date(), activeCallInfo.startTime, { includeSeconds: true });
    return `Call duration: ${duration}`;
  };
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="relative w-full max-w-md h-[85vh] bg-black rounded-xl shadow-xl overflow-hidden flex flex-col">
        {/* Hidden audio elements */}
        <audio ref={localAudioRef} autoPlay playsInline className="hidden" />
        <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />
        
        {/* Header */}
        <div className="bg-primary text-white p-4 flex justify-between items-center">
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8 text-white"
            onClick={handleExit}
          >
            <ChevronLeft />
          </Button>
          <div className="text-center">
            <h2 className="font-semibold">Voice Call</h2>
            <p className="text-xs opacity-80">{getParticipantDisplay()}</p>
          </div>
          <div className="w-8"></div> {/* Spacer for alignment */}
        </div>

        {/* Call area */}
        <div className="flex-1 flex flex-col items-center justify-center p-6 bg-primary-dark/10">
          {/* Avatar area */}
          <div className="flex-1 flex flex-col items-center justify-center w-full">
            {calling ? (
              <div className="text-center">
                <div className="w-32 h-32 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-6 animate-pulse">
                  <Phone className="h-16 w-16 text-primary" />
                </div>
                <h3 className="text-xl font-medium mb-2">Calling...</h3>
                <p className="text-muted-foreground">Waiting for someone to answer</p>
              </div>
            ) : inCall ? (
              <div className="text-center">
                <div className="w-32 h-32 bg-primary rounded-full flex items-center justify-center mx-auto mb-6 relative">
                  <Users className="h-16 w-16 text-white" />
                  <div className="absolute bottom-0 right-0 w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                    <Volume2 className="h-4 w-4 text-white" />
                  </div>
                </div>
                <h3 className="text-xl font-medium mb-2">In Call</h3>
                <p className="text-muted-foreground">{getCallDuration()}</p>
                <div className="mt-4 flex items-center justify-center">
                  <div className="flex space-x-2 text-sm text-muted-foreground">
                    <Users className="h-4 w-4 mr-1" />
                    <span>{activeCallInfo?.participants.length || 1} participant(s)</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center">
                <div className="w-32 h-32 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Phone className="h-16 w-16 text-primary" />
                </div>
                <h3 className="text-xl font-medium mb-2">Start a Voice Call</h3>
                <p className="text-muted-foreground">Connect with other participants</p>
                <Button 
                  className="mt-6"
                  onClick={startCall}
                >
                  Start Call
                </Button>
              </div>
            )}
          </div>
        </div>
        
        {/* Controls */}
        {(inCall || calling) && (
          <div className="bg-card p-4 flex justify-center space-x-4">
            <Button
              variant={audioEnabled ? "outline" : "destructive"}
              size="icon"
              className="rounded-full h-12 w-12"
              onClick={toggleMute}
            >
              {audioEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
            </Button>
            <Button
              variant="destructive"
              size="icon"
              className="rounded-full h-12 w-12"
              onClick={handleHangUp}
            >
              <PhoneOff className="h-5 w-5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default VoiceCall;