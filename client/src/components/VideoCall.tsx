import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { 
  Phone, PhoneOff, Mic, MicOff, Video, VideoOff, User, Clock,
  ChevronLeft, Move, Volume2, Users
} from "lucide-react";
import { WsMessageType, WsMessage } from '@shared/schema';
import { formatDistance } from 'date-fns';

interface VideoCallProps {
  roomId: string;
  nickname: string;
  sendMessage: (message: WsMessage) => void;
  onClose: () => void;
  connectionStatus: string;
  lastVideoCallMessage?: WsMessage | null;
  activeCallInfo?: {
    isCallActive: boolean;
    participants: string[];
    initiatedBy: string;
    startTime?: Date;
  };
}

const VideoCall: React.FC<VideoCallProps> = ({
  roomId,
  nickname,
  sendMessage,
  onClose,
  connectionStatus,
  lastVideoCallMessage,
  activeCallInfo
}) => {
  const [calling, setCalling] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  
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
  
  // Process lastVideoCallMessage whenever it changes
  useEffect(() => {
    if (lastVideoCallMessage) {
      console.log("Processing video call message in VideoCall component:", lastVideoCallMessage.type);
      handleVideoCallMessage(lastVideoCallMessage);
    }
  }, [lastVideoCallMessage]);
  
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
      const permissions = await navigator.permissions.query({ name: 'camera' as PermissionName });
      console.log("Camera permission status:", permissions.state);
      
      // For browsers that don't support permissions API or if permission is prompt/granted
      try {
        console.log("Requesting user media...");
        // Explicitly request both with constraints to ensure proper prompting
        return await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: { width: { ideal: 1280 }, height: { ideal: 720 } }
        });
      } catch (mediaError) {
        console.error("Error accessing media devices:", mediaError);
        throw mediaError;
      }
    } catch (error) {
      console.error("Permission check failed:", error);
      // Fallback for browsers that don't support permissions API
      try {
        console.log("Fallback: directly requesting user media...");
        return await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
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
        description: "Please allow access to your camera and microphone when prompted.",
      });
      
      // Get user media
      console.log("Getting user media...");
      localStream.current = await getUserMedia();
      console.log("User media obtained successfully");
      
      // Display local video
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream.current;
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
            description: "Camera or microphone access was denied. Please allow access in your browser settings and try again.",
            variant: "destructive"
          });
        } else if (error.name === 'NotFoundError') {
          toast({
            title: "Devices Not Found",
            description: "No camera or microphone was found on your device.",
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
          description: "Could not access camera or microphone. Please check permissions.",
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
    if (remoteVideoRef.current && event.streams && event.streams[0]) {
      remoteVideoRef.current.srcObject = event.streams[0];
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
        description: `${caller} is calling. Please allow access to your camera and microphone.`,
      });
      
      // Get user media using our improved function
      console.log("Getting user media for incoming call...");
      localStream.current = await getUserMedia();
      console.log("User media obtained successfully for incoming call");
      
      // Display local video
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream.current;
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
            description: "Camera or microphone access was denied. The call cannot proceed.",
            variant: "destructive"
          });
        } else if (error.name === 'NotFoundError') {
          toast({
            title: "Devices Not Found",
            description: "No camera or microphone was found on your device.",
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
          description: "Could not access camera or microphone. Please check your device permissions.",
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
    
    // Reset video elements
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    
    // Close the video UI - this doesn't end the call for others
    onClose();
  };
  
  // Toggle audio
  const toggleAudio = () => {
    if (localStream.current) {
      const audioTrack = localStream.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioEnabled;
        setAudioEnabled(!audioEnabled);
      }
    }
  };
  
  // Toggle video
  const toggleVideo = () => {
    if (localStream.current) {
      const videoTrack = localStream.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoEnabled;
        setVideoEnabled(!videoEnabled);
      }
    }
  };
  
  // Handle video call signaling messages
  const handleVideoCallMessage = (message: WsMessage) => {
    if (!message.payload) return;
    
    switch (message.type) {
      case WsMessageType.VIDEO_CALL_START:
        // Check if this is a joining request or a normal call start
        if (message.payload.joining) {
          // This is a request from another user to join an existing call
          // If we're in a call, we should send them an offer so they can join
          if (inCall && peerConnection.current && peerConnection.current.localDescription) {
            console.log(`User ${message.payload.caller} is requesting to join our call, sending offer`);
            
            // Send our current offer to the joining user
            sendMessage({
              type: WsMessageType.VIDEO_CALL_START,
              payload: {
                sdp: peerConnection.current.localDescription,
                roomId,
                caller: nickname,
                target: message.payload.userId // Send only to the joining user
              }
            });
          }
        } else if (message.payload.sdp) {
          // Check if we're already in a call
          if (inCall) {
            console.log("Received a call offer while already in call. Ignoring.");
            return;
          }
          
          // Normal incoming call with SDP offer
          handleIncomingCall(message.payload.sdp, message.payload.caller);
        }
        break;
        
      case WsMessageType.VIDEO_CALL_ANSWER:
        // Someone answered our call
        if (calling && peerConnection.current) {
          handleAnswerCall(message.payload.sdp);
        }
        break;
        
      case WsMessageType.VIDEO_CALL_ICE:
        // Received ICE candidate
        if (peerConnection.current && (inCall || calling)) {
          handleRemoteICECandidate(message.payload.candidate);
        }
        break;
        
      case WsMessageType.VIDEO_CALL_HANGUP:
        // Only handle hangup if we're in a call
        if (inCall || calling) {
          // If we were the only other participant, close our call UI
          const sender = message.payload.from;
          if (activeCallInfo?.participants.length === 2 && 
              activeCallInfo.participants.includes(sender) && 
              activeCallInfo.participants.includes(nickname)) {
            console.log("Last participant left the call, closing our call interface");
            handleHangUp();
          } else {
            console.log(`User ${sender} left the call, but call remains active with other participants`);
            
            // Update participants list without closing our call
            toast({
              title: "Call Update",
              description: `${sender} left the call`
            });
          }
        }
        break;
    }
  };
  
  return (
    <div className="fixed inset-0 bg-black/95 z-50 flex flex-col">
      {/* Header with call info */}
      <div className="bg-gray-900/90 px-4 py-3 flex items-center">
        <Button
          variant="ghost"
          size="icon"
          className="mr-2 text-white hover:bg-gray-800"
          onClick={handleHangUp}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        
        <div className="flex-1">
          <h3 className="text-white font-medium">
            {inCall ? (
              `Call with ${activeCallInfo?.participants.filter(p => p !== nickname).join(', ') || 'Unknown'}`
            ) : calling ? (
              'Calling...'
            ) : activeCallInfo?.isCallActive ? (
              'Ongoing Call'
            ) : (
              'Video Call'
            )}
          </h3>
          
          {inCall && activeCallInfo?.startTime && (
            <div className="text-xs text-gray-300 flex items-center">
              <Clock className="h-3 w-3 mr-1" />
              {formatDistance(new Date(activeCallInfo.startTime), new Date(), { addSuffix: false })}
            </div>
          )}
          
          {calling && (
            <div className="text-xs text-gray-300">
              Waiting for answer...
            </div>
          )}
          
          {!inCall && !calling && activeCallInfo?.isCallActive && (
            <div className="text-xs text-emerald-400 flex items-center">
              <span className="h-2 w-2 rounded-full bg-emerald-500 mr-1 animate-pulse"></span>
              Active call with {activeCallInfo.participants.filter(p => p !== nickname).join(', ')}
            </div>
          )}
        </div>
      </div>
      
      {/* Main content area */}
      <div className="flex-1 relative bg-gray-950 flex items-center justify-center">
        {/* Remote video (full screen) */}
        <div className="absolute inset-0 flex items-center justify-center">
          <video
            ref={remoteVideoRef}
            className="w-full h-full object-cover"
            autoPlay
            playsInline
          />
          
          {/* Overlay when not in call */}
          {!inCall && (
            <div className="absolute inset-0 bg-gray-900/80 flex flex-col items-center justify-center text-white p-6 text-center">
              {calling ? (
                <div className="animate-pulse flex flex-col items-center">
                  <div className="w-24 h-24 bg-gray-800 rounded-full flex items-center justify-center mb-5 border-4 border-primary">
                    <Phone className="h-10 w-10 text-primary" />
                  </div>
                  <p className="text-xl font-medium">Calling...</p>
                  <p className="text-sm text-gray-300 mt-3 max-w-xs">
                    Waiting for someone to join. This may take a moment.
                  </p>
                </div>
              ) : activeCallInfo?.isCallActive ? (
                <div className="flex flex-col items-center">
                  <div className="w-24 h-24 bg-gray-800 rounded-full flex items-center justify-center mb-5 border-4 border-emerald-500">
                    <Users className="h-10 w-10 text-emerald-400" />
                  </div>
                  <p className="text-xl font-medium">Active Call</p>
                  <p className="text-sm text-gray-300 mt-2 max-w-xs">
                    {activeCallInfo.participants.filter(p => p !== nickname).join(', ')} {activeCallInfo.participants.length > 2 ? 'are' : 'is'} in this call
                  </p>
                  {activeCallInfo.startTime && (
                    <div className="mt-3 flex items-center text-emerald-400 bg-emerald-900/30 px-3 py-1 rounded-full">
                      <Clock className="h-4 w-4 mr-1" />
                      <span className="text-sm">
                        Started {formatDistance(new Date(activeCallInfo.startTime), new Date(), { addSuffix: true })}
                      </span>
                    </div>
                  )}
                  <p className="text-sm text-gray-300 mt-5">Click the green button below to join</p>
                </div>
              ) : (
                <div className="flex flex-col items-center max-w-xs">
                  <div className="w-24 h-24 bg-gray-800 rounded-full flex items-center justify-center mb-5 border-4 border-gray-700">
                    <Video className="h-10 w-10 text-gray-400" />
                  </div>
                  <p className="text-xl font-medium">Start a Video Call</p>
                  <p className="text-sm text-gray-300 mt-3">
                    Connect with others through video. Click the green button below to start calling.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* Local video (small, overlaid in corner) */}
        <div className="absolute top-4 right-4 w-1/4 max-w-[180px] aspect-video bg-gray-800 rounded-lg overflow-hidden shadow-xl border border-gray-700">
          <video
            ref={localVideoRef}
            className="w-full h-full object-cover transform scale-x-[-1]"
            autoPlay
            playsInline
            muted
          />
          {(!localStream.current || localStream.current.getVideoTracks().length === 0) && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-800 text-white">
              <div className="text-center p-2">
                <User className="h-8 w-8 mx-auto mb-1 opacity-50" />
                <p className="text-xs">Camera off</p>
              </div>
            </div>
          )}
          
          {/* Drag handle to reposition local video */}
          <div className="absolute top-1 right-1 bg-gray-900/50 rounded-full p-1 cursor-move">
            <Move className="h-3 w-3 text-gray-400" />
          </div>
        </div>
      </div>
      
      {/* Controls */}
      <div className="bg-gray-900 p-5 flex items-center justify-center space-x-5">
        <Button
          variant={audioEnabled ? "ghost" : "destructive"}
          size="icon"
          className={`rounded-full h-14 w-14 ${audioEnabled ? 'bg-gray-800 text-white hover:bg-gray-700' : ''}`}
          onClick={toggleAudio}
          disabled={!inCall && !calling}
        >
          {audioEnabled ? <Mic className="h-6 w-6" /> : <MicOff className="h-6 w-6" />}
        </Button>
        
        <Button
          variant={videoEnabled ? "ghost" : "destructive"}
          size="icon"
          className={`rounded-full h-14 w-14 ${videoEnabled ? 'bg-gray-800 text-white hover:bg-gray-700' : ''}`}
          onClick={toggleVideo}
          disabled={!inCall && !calling}
        >
          {videoEnabled ? <Video className="h-6 w-6" /> : <VideoOff className="h-6 w-6" />}
        </Button>
        
        {!inCall && !calling && (
          <Button
            variant="default"
            size="icon"
            className="rounded-full h-16 w-16 bg-green-600 hover:bg-green-700"
            onClick={startCall}
          >
            <Phone className="h-7 w-7" />
          </Button>
        )}
        
        <Button
          variant="destructive"
          size="icon"
          className="rounded-full h-14 w-14"
          onClick={handleHangUp}
        >
          <PhoneOff className="h-6 w-6" />
        </Button>
        
        {inCall && (
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full h-14 w-14 bg-gray-800 text-white hover:bg-gray-700"
            onClick={() => {
              // This would toggle speakerphone in a real mobile app
              toast({
                title: "Speaker toggled",
                description: "This would toggle speakerphone on a mobile device"
              });
            }}
          >
            <Volume2 className="h-6 w-6" />
          </Button>
        )}
      </div>
    </div>
  );
};

export default VideoCall;